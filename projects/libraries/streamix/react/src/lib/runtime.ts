import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { Atom, DependencySource, Writable } from "@epikodelabs/streamix";
import { recordStreamixDevtoolsEvent } from "./devtools";

export type AtomSnapshot = Record<string, unknown>;

export interface AtomSnapshotPayload {
  readonly version: 1;
  readonly atoms: AtomSnapshot;
}

type Disposable = { dispose(): void };
type Listener = () => void;

// Shared compiler runtime. Keeping these helpers in the adapter means every
// transformed module observes the same subscription and ownership registries,
// rather than injecting a private copy into each compiled file.
const compilerSubscriptions = new WeakMap<object, {
  listeners: Set<Listener>;
  stop: (() => void) | null;
  generation: number;
  version: number;
  value: unknown;
  snapshot: { readonly version: number; readonly value: unknown };
}>();
const compilerLocalDisposals = new WeakMap<object, object>();

/**
 * Explicit lifetime for compiler-owned atom and scope instances beneath
 * React Activity/Offscreen. React effect cleanup is not an unmount signal:
 * hidden trees tear down effects and later reuse the same hook state.
 *
 * Create this outside the hidden subtree, place a StreamixLifetimeProvider
 * around it, and call lifetime.dispose() when the containing feature is
 * permanently destroyed. Only committed instances are registered.
 */
export interface StreamixLifetime {
  readonly disposed: boolean;
  retain(value: unknown): void;
  dispose(): void;
}

export function createStreamixLifetime(): StreamixLifetime {
  const owned = new Set<Disposable>();
  let disposed = false;
  return {
    get disposed() { return disposed; },
    retain(value) {
      if (disposed) throw new Error("Cannot register a Streamix instance with a disposed lifetime.");
      if (isDisposable(value)) owned.add(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const instance of owned) {
        try { instance.dispose(); } catch (error) { errors.push(error); }
      }
      owned.clear();
      if (errors.length) throw new AggregateError(errors, "Streamix lifetime disposal failed.");
    },
  };
}

const StreamixLifetimeContext = createContext<StreamixLifetime | null>(null);

export function StreamixLifetimeProvider(props: {
  readonly lifetime: StreamixLifetime;
  readonly children?: ReactNode;
}): ReturnType<typeof createElement> {
  return createElement(StreamixLifetimeContext.Provider, { value: props.lifetime }, props.children);
}

function isDisposable(value: unknown): value is Disposable {
  return (typeof value === "object" || typeof value === "function") && value !== null &&
    typeof (value as Partial<Disposable>).dispose === "function";
}

/** @internal Shared compiler trace bridge; emitted only after React commits. */
export function __streamixTrace(
  type: "read" | "subscription" | "write" | "unsubscribe" | "render",
  source: string,
): void {
  recordStreamixDevtoolsEvent({ type, source });
}

/** @internal Registers compiler tracing only after a component commits. */
export function useStreamixAfterCommit(effect: () => void): void {
  useEffect(effect);
}

/** @internal Stable component-local ownership slot used by compiler output. */
export function useStreamixLocal<T>(factory: () => T): T {
  const lifetime = useContext(StreamixLifetimeContext);
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = factory();

  useEffect(() => {
    if (lifetime) {
      lifetime.retain(ref.current);
      // A hidden Activity cleans effects up but keeps this React hook slot.
      // Dispose only at the explicit lifetime boundary, not on hide.
      return;
    }
    const instance = ref.current!;
    const token = {};
    if ((typeof instance === "object" || typeof instance === "function") && instance !== null) {
      compilerLocalDisposals.set(instance, token);
    }
    return () => {
      queueMicrotask(() => {
        if ((typeof instance === "object" || typeof instance === "function") && instance !== null) {
          if (compilerLocalDisposals.get(instance) !== token) return;
          compilerLocalDisposals.delete(instance);
        }
        if (isDisposable(instance)) instance.dispose();
      });
    };
  }, [lifetime]);

  return ref.current;
}

/** @internal Concurrent-safe shared subscription used by compiler JSX reads. */
export function useStreamixSource<T>(source: DependencySource<T>, sourceName = "dynamic atom"): T {
  const entryFor = (): NonNullable<ReturnType<typeof compilerSubscriptions.get>> => {
    const sourceKey = source as unknown as object;
    let entry = compilerSubscriptions.get(sourceKey);
    if (!entry) {
      entry = { listeners: new Set(), stop: null, generation: 0, version: 0, value: source.value, snapshot: { version: 0, value: source.value } };
      compilerSubscriptions.set(sourceKey, entry);
    }
    return entry;
  };
  const subscribe = useCallback((notify: Listener) => {
      __streamixTrace("subscription", sourceName);
      const sourceKey = source as unknown as object;
      const entry = entryFor();
      entry.generation++;
      // Subscribe before joining the listener set: stateful atoms replay the
      // current value synchronously during subscribe, and the value a new
      // subscriber will read through getSnapshot is that same replay. Joining
      // afterwards keeps React free of a redundant synchronous store change.
      if (!entry.stop) {
        let replaying = true;
        entry.stop = source.subscribe(() => {
          entry!.version++;
          entry!.value = source.value;
          entry!.snapshot = { version: entry!.version, value: entry!.value };
          // The first replay initializes the subscription; it isn't a write.
          if (replaying) return;
          __streamixTrace("write", sourceName);
          for (const listener of entry!.listeners) listener();
        });
        replaying = false;
      }
      entry.listeners.add(notify);
      return () => {
        entry!.listeners.delete(notify);
        if (entry!.listeners.size > 0) return;
        const generation = ++entry!.generation;
        queueMicrotask(() => {
          if (entry!.generation !== generation || entry!.listeners.size > 0) return;
          __streamixTrace("unsubscribe", sourceName);
          entry!.stop?.();
          compilerSubscriptions.delete(sourceKey);
        });
      };
    }, [source, sourceName]);
  const getSnapshot = useCallback(() => {
    const entry = entryFor();
    // Accommodate stores changed before their first subscriber attaches.
    if (!Object.is(entry.value, source.value)) {
      entry.version++;
      entry.value = source.value;
      entry.snapshot = { version: entry.version, value: entry.value };
    }
    return entry.snapshot;
  }, [source]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).value as T;
}

// Legacy runtime names remain available for modules generated by older builds.
export const __streamixAfterCommit = useStreamixAfterCommit;
export const __streamixLocal = useStreamixLocal;
export const __streamixUse = useStreamixSource;

/** Reads an atom explicitly, without compiler involvement. */
export function read<T>(source: DependencySource<T>): T {
  return source.value;
}

/** Writes an atom explicitly, without compiler involvement. */
export function write<T>(source: Writable<T>, value: T): void {
  source.next(value);
}

/** Marks an atom reference intended to cross a component boundary. */
export function atomRef<T extends Atom<any>>(source: T): T {
  return source;
}

/**
 * Subscribes to a Streamix source using React's concurrent-safe external-store
 * contract. It is the non-compiler equivalent of a direct JSX atom read.
 */
export function useAtomValue<T>(source: DependencySource<T>): T {
  // The explicit API and compiler syntax must share revisioned snapshots:
  // Object.is(value, value) cannot detect same-identity object emissions.
  return useStreamixSource(source, "explicit atom read");
}

/** React-style value/setter binding for a writable atom. */
export type WritableUpdate<T> = T | ((previous: T) => T);

export function useWritable<T>(source: Writable<T>): [T, (value: WritableUpdate<T>) => void] {
  const value = useAtomValue(source);
  const setValue = useCallback((next: WritableUpdate<T>) =>
    source.next(typeof next === "function" ? (next as (previous: T) => T)(source.value) : next), [source]);
  return [value, setValue];
}

/**
 * Creates a component-owned atom once per mounted component instance.
 * Factories must be render-pure: React may invoke them for an abandoned or
 * Strict-Mode development render. The owned atom is disposed after unmount.
 *
 * Ownership delegates to the same Strict-Mode-safe slot the compiler uses: the
 * dispose pass is cancelled when the instance is re-owned by the remount of
 * the same component, so a simulated Strict-Mode teardown never disposes an
 * atom the committed component still holds.
 */
export function useAtom<T extends Atom<any>>(factory: () => T): T {
  return useStreamixLocal(factory);
}

export type ResourceStatus = "pending" | "ready" | "error";

export interface Resource<T> {
  readonly status: ResourceStatus;
  readonly data: T | undefined;
  readonly error: unknown;
  /** Returns data, suspends while pending, and throws on failure. */
  read(): T;
  /** Starts a fresh request and cancels the previous request. */
  reload(): void;
}

export interface PreloadedResource<T> extends Resource<T> {
  /** Explicitly starts loading outside render (route loader, event, or SSR). */
  preload(): void;
  /** Cancels an in-flight request and releases listeners. */
  dispose(): void;
  subscribe(listener: Listener): () => void;
}

/**
 * Creates an explicit Suspense resource. Loading begins only when `preload()`
 * is called, never as a side effect of render. Call `preload()` in a route
 * loader, event handler, server request setup, or an effect before `read()`.
 */
export function createResource<T>(loader: (signal: AbortSignal) => Promise<T>): PreloadedResource<T> {
  let status: ResourceStatus = "pending";
  let data: T | undefined;
  let error: unknown;
  let promise: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let disposed = false;
  const listeners = new Set<Listener>();
  const notify = () => { for (const listener of listeners) listener(); };

  const preload = () => {
    if (disposed || promise) return;
    const active = new AbortController();
    controller = active;
    promise = Promise.resolve().then(() => loader(active.signal)).then(
      value => { if (!disposed && controller === active && !active.signal.aborted) { status = "ready"; data = value; notify(); } },
      reason => { if (!disposed && controller === active && !active.signal.aborted) { status = "error"; error = reason; notify(); } },
    );
    notify();
  };

  return {
    get status() { return status; },
    get data() { return data; },
    get error() { return error; },
    read() {
      if (!promise) throw new Error("Resource has not been preloaded. Start it outside render with resource.preload().");
      if (status === "pending") throw promise;
      if (status === "error") throw error;
      return data as T;
    },
    reload() {
      controller?.abort();
      promise = undefined;
      status = "pending";
      data = undefined;
      error = undefined;
      preload();
    },
    preload,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller?.abort();
      listeners.clear();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * Runs an abortable async loader with React-safe cancellation and a Suspense /
 * error-boundary compatible `read()` method.
 */
/**
 * Observe a resource whose loading starts outside render. In particular,
 * Suspense never throws a fulfilled placeholder promise for an idle resource.
 * This is safe with concurrent rendering and aborted initial mounts.
 */
export function usePreloadedResource<T>(resource: PreloadedResource<T>): Resource<T> {
  const subscribe = useCallback((notify: Listener) => resource.subscribe(notify), [resource]);
  // An object snapshot must be cached. Subscribe to the primitive revision instead.
  const version = useRef({ resource, version: 0, current: resource.status, data: resource.data, error: resource.error });
  const getSnapshot = useCallback(() => {
    const prev = version.current;
    if (prev.resource !== resource || prev.current !== resource.status || prev.data !== resource.data || prev.error !== resource.error) {
      version.current = { resource, version: prev.version + 1, current: resource.status, data: resource.data, error: resource.error };
    }
    return version.current;
  }, [resource]);
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return resource;
}

/**
 * Component-owned async resource. Loading begins after commit. Consumers may
 * display `status` or call `read()` once the resource is ready. For initial
 * Suspense, use createResource().preload() before rendering and
 * usePreloadedResource(); effects cannot start loads in suspended renders.
 */
export function useResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  dependencies: readonly unknown[],
): Resource<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const resource = useMemo(
    () => createResource<T>(signal => loaderRef.current(signal)),
    dependencies,
  );
  const lifetime = useContext(StreamixLifetimeContext);
  const previousResource = useRef<PreloadedResource<T> | null>(null);
  useEffect(() => {
    if (lifetime) {
      if (previousResource.current && previousResource.current !== resource) previousResource.current.dispose();
      previousResource.current = resource;
      lifetime.retain(resource);
      resource.preload();
      // Activity hide is not a cancellation request. The lifetime is managed
      // outside the hidden subtree; dependency changes still dispose the old
      // resource in the next effect above.
      return;
    }
    resource.preload();
    // React Strict Mode deliberately performs effect setup → cleanup → setup
    // for the same committed hook state. Resource disposal is terminal, so
    // defer it by one microtask and let the next setup take ownership again.
    // A real unmount (or a dependency change) has no matching setup for this
    // resource and therefore still disposes it promptly.
    const token = {};
    compilerLocalDisposals.set(resource, token);
    return () => {
      queueMicrotask(() => {
        if (compilerLocalDisposals.get(resource) !== token) return;
        compilerLocalDisposals.delete(resource);
        resource.dispose();
      });
    };
  }, [resource, lifetime]);
  return usePreloadedResource(resource);
}

/** Captures named atom values for an SSR payload. */
export function createAtomSnapshot(sources: Record<string, DependencySource<unknown>>): AtomSnapshot {
  return Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.value]));
}

/** Applies a validated SSR payload to named writable atoms before hydration. */
export function hydrateAtomSnapshot(
  targets: Record<string, Writable<unknown>>,
  snapshot: AtomSnapshot,
): void {
  for (const [name, value] of Object.entries(snapshot)) {
    if (!Object.prototype.hasOwnProperty.call(targets, name)) throw new Error(`Unknown atom snapshot key: ${name}`);
    targets[name].next(value);
  }
}

/** Creates a JSON-safe, versioned SSR payload from named atom snapshots. */
export function serializeAtomSnapshot(sources: Record<string, DependencySource<unknown>>): string {
  const payload: AtomSnapshotPayload = { version: 1, atoms: createAtomSnapshot(sources) };
  let json: string | undefined;
  try {
    json = JSON.stringify(payload);
  } catch (error) {
    throw new Error(`Atom snapshot is not serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (json === undefined) throw new Error("Atom snapshot is not serializable");
  // Safe for embedding in a non-executable <script type="application/json">.
  return json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Parses and validates a versioned SSR payload before client hydration. */
export function parseAtomSnapshot(serialized: string): AtomSnapshotPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Invalid Streamix atom snapshot JSON");
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { atoms?: unknown }).atoms !== "object" ||
    (parsed as { atoms?: unknown }).atoms === null ||
    Array.isArray((parsed as { atoms: unknown }).atoms)
  ) {
    throw new Error("Invalid Streamix atom snapshot payload");
  }
  return parsed as AtomSnapshotPayload;
}

/** Validates matching server/client atom keys, then applies the payload. */
export function hydrateAtomPayload(
  targets: Record<string, Writable<unknown>>,
  payload: AtomSnapshotPayload,
): void {
  const expected = Object.keys(targets).sort();
  const received = Object.keys(payload.atoms).sort();
  if (expected.length !== received.length || expected.some((name, index) => name !== received[index])) {
    throw new Error(`Atom snapshot keys do not match hydration targets (expected: ${expected.join(", ")}; received: ${received.join(", ")})`);
  }
  hydrateAtomSnapshot(targets, payload.atoms);
}

/**
 * Produces a non-executable SSR payload element. Render this beside the React
 * root on the server, then consume it before `hydrateRoot` on the client.
 */
export function renderAtomSnapshotScript(
  sources: Record<string, DependencySource<unknown>>,
  id = "__streamix_snapshot",
): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error("Streamix snapshot element id must contain only letters, numbers, underscores, or hyphens");
  }
  return `<script id="${id}" type="application/json">${serializeAtomSnapshot(sources)}</script>`;
}

/**
 * Reads, validates, and applies the server snapshot before React hydration.
 * The element is removed after a successful handoff so it cannot be applied
 * twice by a later client navigation.
 */
export function hydrateAtomSnapshotFromDocument(
  targets: Record<string, Writable<unknown>>,
  id = "__streamix_snapshot",
  documentRoot: Pick<Document, "getElementById"> | undefined = typeof document === "undefined" ? undefined : document,
): void {
  if (!documentRoot) throw new Error("Cannot hydrate a Streamix snapshot without a document");
  const element = documentRoot.getElementById(id);
  if (!element) throw new Error(`Missing Streamix snapshot element: #${id}`);
  hydrateAtomPayload(targets, parseAtomSnapshot(element.textContent ?? ""));
  element.remove();
}
