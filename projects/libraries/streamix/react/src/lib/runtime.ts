import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Readable, DependencySource, Writable } from "@epikodelabs/streamix";
import { NO_INITIAL_VALUE, __streamixRuntime, ɵcreateDisposer, ɵtrackDisposal, waitForDisposal } from "@epikodelabs/streamix";
import { recordStreamixDevtoolsEvent, streamixDevtoolsEnabled } from "./devtools";

export type AtomSnapshot = Record<string, unknown>;

export interface AtomSnapshotPayload {
  /** Version 1 payloads are plain JSON; version 2 tags `undefined` values. */
  readonly version: 1 | 2;
  readonly atoms: AtomSnapshot;
}

type Disposable = { dispose(): void | Promise<void> };
type Listener = () => void;

async function settleSubscriptionTeardown(stop: () => unknown): Promise<void> {
  try {
    await stop();
  } catch (error) {
    console.error("[streamix] React subscription teardown failed:", error);
  }
}

type CompilerSubscriptionEntry = {
  listeners: Set<Listener>;
  stop: (() => void | Promise<void>) | null;
  generation: number;
  version: number;
  value: unknown;
  /** Last failure observed for the source, delivered through the render. */
  error: unknown;
  snapshot: { readonly version: number; readonly value: unknown };
};

// Shared compiler runtime. Keeping these helpers in the adapter means every
// transformed module observes the same subscription and ownership registries,
// rather than injecting a private copy into each compiled file. Entries are
// split by dedupe mode: compiler reads and explicit read hatches have
// different equal-emission contracts and must not inherit whichever one
// subscribed first.
const compilerSubscriptions = new WeakMap<object, Map<boolean, CompilerSubscriptionEntry>>();
const compilerLocalDisposals = new WeakMap<object, object>();

// Framework reads expose pending state as undefined, never as the core sentinel.
function viewValue<T>(value: T): T {
  return value === NO_INITIAL_VALUE ? undefined as T : value;
}

/**
 * Framework delivery contract, shared with the Vue and Angular adapters:
 * a failed source read delivers its error through React's error boundary,
 * pending reads stay undefined, and a completed source (`disposed` without
 * an error) keeps its last emission — completion is never failure.
 */
type SourceState =
  | { status: "value"; value: unknown }
  | { status: "pending" }
  | { status: "completed" }
  | { status: "failed"; error: unknown };

function isDisposedSource(source: DependencySource<unknown>): boolean {
  return (source as { disposed?: unknown }).disposed === true;
}

function readSourceState(source: DependencySource<unknown>): SourceState {
  // `disposed && error !== undefined` is the only failure discriminator for a
  // terminated atom; a disposed atom without an error completed normally.
  const disposed = isDisposedSource(source);
  const storedError = (source as { error?: unknown }).error;
  if (disposed && storedError !== undefined) return { status: "failed", error: storedError };
  if (disposed) return { status: "completed" };
  try {
    const value = source.value;
    return value === NO_INITIAL_VALUE ? { status: "pending" } : { status: "value", value };
  } catch (error) {
    return { status: "failed", error: storedError !== undefined ? storedError : error };
  }
}

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
  dispose(): Promise<void>;
}

export function createStreamixLifetime(): StreamixLifetime {
  const owned = new Set<Disposable>();
  let disposed = false;
  const lifetime: StreamixLifetime = {
    get disposed() { return disposed; },
    retain(value) {
      if (disposed) throw new Error("Cannot register a Streamix instance with a disposed lifetime.");
      if (isDisposable(value)) owned.add(value);
    },
    dispose: ɵcreateDisposer(queue => {
      disposed = true;
      for (const instance of owned) queue.run(() => instance.dispose());
      owned.clear();
      // React may run a parent's effect cleanup before its children's cleanup.
      queue.run(() => Promise.resolve().then(() => waitForDisposal(lifetime)));
    }),
  };
  return lifetime;
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

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** True when a retained render-owned instance was terminated by its owner. */
function isDisposed(value: unknown): boolean {
  if (!isObjectLike(value)) return false;
  const record = value as { disposed?: unknown; _disposed?: unknown };
  return record.disposed === true || record._disposed === true;
}

/** Compiler-path writes since the last traced render. Renders generated by
 * older builds trace through this legacy counter; current builds pass their
 * own source references and compare {@link sourceWriteVersions} instead, so
 * one component's write cannot be consumed by another component's commit. */
let pendingWrites = 0;
/** Set while a source-attributed render trace runs, so it bypasses the legacy
 * counter and clears writes that its source list has already accounted for. */
let attributedRender = false;

/** Monotonic write revision per subscribed source object. Keyed by the source
 * rather than its trace label: the same atom can carry different labels in
 * compiler bindings and explicit read hooks. */
const sourceWriteVersions = new WeakMap<object, number>();

function isObjectSource(source: unknown): source is object {
  return (typeof source === "object" && source !== null) || typeof source === "function";
}

function sourceWriteVersion(source: object): number {
  return sourceWriteVersions.get(source) ?? 0;
}

/** @internal Shared compiler trace bridge; emitted only after React commits. */
export function __streamixTrace(
  type: "read" | "subscription" | "write" | "unsubscribe" | "render",
  source: string,
  countsAsWrite = true,
  value?: unknown,
): void {
  // Production bundles keep the trace seams inert; the recorder below is a
  // no-op there, and the attribution bookkeeping must stay equally cheap.
  if (!streamixDevtoolsEnabled) return;
  if (type === "write" && countsAsWrite) pendingWrites++;
  if (type === "render") {
    if (attributedRender) {
      // The component's own source revisions already established the write;
      // drain the legacy counter so it cannot misattribute a later render.
      pendingWrites = 0;
    } else {
      // Legacy path (generated modules without a source list): Angular parity
      // — a committed render is traced only when a write happened since the
      // previous render event.
      if (pendingWrites === 0) return;
      pendingWrites = 0;
    }
  }
  let preview: string | undefined;
  if (type === "write" && value !== undefined) {
    // Bounded preview so the trace line says what changed, not just where.
    try { preview = (typeof value === "string" ? value : JSON.stringify(value))?.slice(0, 240); }
    catch { preview = String(value); }
  }
  recordStreamixDevtoolsEvent({ type, source, ...(preview !== undefined ? { value: preview } : {}) });
}

/** @internal Registers compiler tracing only after a component commits.
 * `sources` are the reactive sources read by this component. Comparing their
 * write revisions against this component's previous commit attributes a
 * render to its own writes even when several components commit in one batch
 * and effects run in tree order. */
export function useStreamixAfterCommit(effect: () => void, sources?: readonly unknown[]): void {
  const committedVersions = useRef<Map<object, number> | null>(null);
  useEffect(() => {
    if (!streamixDevtoolsEnabled || sources === undefined) {
      // Legacy callers (and production) keep the unconditional contract.
      effect();
      return;
    }
    const previous = committedVersions.current;
    if (previous === null) {
      // Mounting is not evidence of a write; baseline current revisions.
      committedVersions.current = new Map(
        sources.filter(isObjectSource).map(source => [source, sourceWriteVersion(source)]),
      );
      return;
    }
    let written = false;
    for (const source of sources) {
      if (!isObjectSource(source)) continue;
      const version = sourceWriteVersion(source);
      const seen = previous.get(source);
      if (seen === undefined) {
        // A binding added by this render starts from the current revision.
        previous.set(source, version);
      } else if (seen !== version) {
        previous.set(source, version);
        written = true;
      }
    }
    for (const source of [...previous.keys()]) if (!sources.includes(source)) previous.delete(source);
    if (!written) return;
    attributedRender = true;
    try { effect(); } finally { attributedRender = false; }
  });
}

/** @internal Stable component-local ownership slot used by compiler output. */
export function useStreamixLocal<T>(factory: () => T): T {
  const lifetime = useContext(StreamixLifetimeContext);
  const ref = useRef<T | null>(null);
  const registration = useRef<(() => void) | null>(null);
  const create = (): T => {
    const pending = __streamixRuntime.provision(factory);
    registration.current = pending.commit;
    return pending.value;
  };
  const [, forceRender] = useState(0);
  if (ref.current === null || isDisposed(ref.current)) {
    // A hidden Activity tears effects down but keeps this hook slot. Without
    // a lifetime provider the deferred cleanup below has already disposed the
    // retained instance, so the re-shown tree must create a fresh one instead
    // of reading through a terminal atom.
    const abandoned = ref.current;
    if (abandoned !== null && isObjectLike(abandoned)) compilerLocalDisposals.delete(abandoned);
    ref.current = create();
  }

  useLayoutEffect(() => {
    // A yielded render may commit after its provisional instance was swept.
    // Replace it and synchronously refresh the view before the browser paints.
    if (isDisposed(ref.current)) {
      ref.current = create();
      forceRender(version => version + 1);
    }
    registration.current?.();
    registration.current = null;
  });

  useEffect(() => {
    if (lifetime) {
      lifetime.retain(ref.current);
      // A hidden Activity cleans effects up but keeps this React hook slot.
      // Dispose only at the explicit lifetime boundary, not on hide.
      return;
    }
    let instance: T = ref.current!;
    if (isDisposed(instance)) {
      // Activity can reveal a hidden tree without re-rendering it. Recreate in
      // the effect too, then force a render so subscriptions leave the
      // terminal instance for the replacement.
      if (isObjectLike(instance)) compilerLocalDisposals.delete(instance);
      instance = ref.current = create();
      registration.current?.();
      registration.current = null;
      forceRender(version => version + 1);
    }
    const token = {};
    if (isObjectLike(instance)) compilerLocalDisposals.set(instance, token);
    return () => {
      queueMicrotask(() => {
        if (isObjectLike(instance)) {
          if (compilerLocalDisposals.get(instance) !== token) return;
          compilerLocalDisposals.delete(instance);
        }
        if (isDisposable(instance)) void settleSubscriptionTeardown(() => instance.dispose());
      });
    };
  }, [lifetime]);

  return ref.current;
}

/** @internal Concurrent-safe shared subscription used by compiler JSX reads.
 * Before the first emission, exposes undefined instead of the pending sentinel.
 * Dedupes equal emissions by default: Angular's binding equals gate skips
 * unchanged values, so an equal emission is not a write — no re-render and
 * no trace event. The explicit read hatches pass `dedupe: false` to keep
 * their in-place-mutation re-render contract. */
export function useStreamixSource<T>(source: DependencySource<T>, sourceName = "dynamic atom", dedupe = true): T {
  const lifetime = useContext(StreamixLifetimeContext);
  const entryFor = (): CompilerSubscriptionEntry => {
    const sourceKey = source as unknown as object;
    let modes = compilerSubscriptions.get(sourceKey);
    if (!modes) {
      modes = new Map();
      compilerSubscriptions.set(sourceKey, modes);
    }
    let entry = modes.get(dedupe);
    if (!entry) {
      // A failed source must not throw while the entry is being built: the
      // error is stored and getSnapshot delivers it during render.
      const state = readSourceState(source);
      const value = state.status === "value" ? viewValue(state.value) : undefined;
      entry = {
        listeners: new Set(),
        stop: null,
        generation: 0,
        version: 0,
        value,
        error: state.status === "failed" ? state.error : undefined,
        snapshot: { version: 0, value },
      };
      modes.set(dedupe, entry);
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
          const state = readSourceState(source);
          if (state.status === "failed") {
            entry!.error = state.error;
          } else if (state.status === "value") {
            const next = viewValue(state.value);
            entry!.error = undefined;
            // Angular parity: the binding equals gate skips unchanged values.
            // An equal emission is not a write — it schedules no render and
            // emits no trace event.
            if (dedupe && Object.is(entry!.value, next)) return;
            entry!.version++;
            entry!.value = next;
            entry!.snapshot = { version: entry!.version, value: next };
          }
          // Pending and completed reads keep the entry's previous state.
          // The first replay initializes the subscription; it isn't a write.
          // Version is bumped for every notified emission, including the
          // dedupe:false equal-reference emissions that force a re-render.
          // The legacy counter still only tracks compiler-deduped writes so
          // explicit-hook emissions cannot leak into another component's
          // legacy render attribution.
          if (replaying) return;
          if (isObjectSource(source)) {
            sourceWriteVersions.set(source, sourceWriteVersion(source) + 1);
          }
          __streamixTrace("write", sourceName, dedupe, entry!.error ?? entry!.value);
          for (const listener of entry!.listeners) listener();
        });
        replaying = false;
        // fail() never notifies value subscribers, so failures reach React
        // only through onError: store the error and force the store-change
        // re-render whose getSnapshot throws into the error boundary.
        const stopError = typeof (source as { onError?: unknown }).onError === "function"
          ? (source as Readable<unknown>).onError((error: unknown) => {
            entry!.error = error;
            for (const listener of entry!.listeners) listener();
          })
          : null;
        const valueStop = entry.stop;
        entry.stop = ɵcreateDisposer(queue => {
          queue.run(valueStop);
          if (stopError) queue.run(stopError);
        });
      }
      entry.listeners.add(notify);
      return () => {
        entry!.listeners.delete(notify);
        if (entry!.listeners.size > 0) return;
        const generation = ++entry!.generation;
        const completion = Promise.resolve().then(() => {
          if (entry!.generation !== generation || entry!.listeners.size > 0) return;
          __streamixTrace("unsubscribe", sourceName);
          const modes = compilerSubscriptions.get(sourceKey);
          if (modes?.get(dedupe) === entry) {
            modes.delete(dedupe);
            if (modes.size === 0) compilerSubscriptions.delete(sourceKey);
          }
          return entry!.stop?.();
        });
        if (lifetime) ɵtrackDisposal(lifetime, completion);
        void settleSubscriptionTeardown(() => completion);
      };
    }, [dedupe, lifetime, source, sourceName]);
  const getSnapshot = useCallback(() => {
    const entry = entryFor();
    // Accommodate stores changed before their first subscriber attaches.
    const state = readSourceState(source);
    if (state.status === "failed") {
      entry.error = state.error;
      // Delivery through the framework: the render that reads this snapshot
      // throws, and the nearest error boundary handles it.
      throw state.error;
    }
    if (state.status === "value") {
      const value = viewValue(state.value);
      entry.error = undefined;
      if (!Object.is(entry.value, value)) {
        entry.version++;
        entry.value = value;
        entry.snapshot = { version: entry.version, value: entry.value };
      }
    }
    // Pending and completed reads keep the entry's previous snapshot.
    return entry.snapshot;
  }, [dedupe, source]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).value as T;
}

// Legacy runtime names remain available for modules generated by older builds.
export const __streamixAfterCommit = useStreamixAfterCommit;
export const __streamixLocal = useStreamixLocal;
export const __streamixUse = useStreamixSource;

/** Reads an atom explicitly, without compiler involvement. */
export function read<T>(source: DependencySource<T>): T {
  // Vue parity: the escape hatch is a trace event, but it triggers no render,
  // so it never counts as a write or consumes render attribution.
  __streamixTrace("read", "explicit atom read");
  const state = readSourceState(source);
  // Delivery contract: failed reads throw to the caller, pending reads are
  // undefined, and completed sources keep the core's own disposed-read
  // semantics (the raw read reports the disposed atom).
  if (state.status === "failed") throw state.error;
  if (state.status === "pending") return undefined as T;
  if (state.status === "completed") return viewValue(source.value);
  return viewValue(state.value) as T;
}

/** Writes an atom explicitly, without compiler involvement. */
export function write<T>(source: Writable<T>, value: T): void {
  // The source's own subscription callback traces the actual emission for
  // components; this hatch event must not create a phantom render.
  __streamixTrace("write", "explicit atom write", false);
  source.next(value);
}

/** Marks an atom reference intended to cross a component boundary. */
export function atomRef<T extends Readable<any>>(source: T): T {
  return source;
}

/**
 * Subscribes to a Streamix source using React's concurrent-safe external-store
 * contract. It is the non-compiler equivalent of a direct JSX atom read.
 */
export function useAtomValue<T>(source: DependencySource<T>): T {
  // The explicit API and compiler syntax must share revisioned snapshots:
  // Object.is(value, value) cannot detect same-identity object emissions.
  // Explicit reads keep re-rendering on every emission, including in-place
  // mutations of the same reference, so the equals gate stays off here.
  return useStreamixSource(source, "explicit atom read", false);
}

/** React-style value/setter binding for a writable atom. */
export type WritableUpdate<T> = T | ((previous: T) => T);

export function useWritable<T>(source: Writable<T>): [T, (value: WritableUpdate<T>) => void] {
  const value = useAtomValue(source);
  const setValue = useCallback((next: WritableUpdate<T>) => {
    // Functional updaters receive the last safe value, never the pending
    // sentinel and never a thrown read: writing to a failed atom is the
    // recovery path, and next() clears the error state.
    let previous: T = undefined as T;
    try { previous = viewValue(source.safeValue); } catch { /* keep undefined */ }
    source.next(typeof next === "function" ? (next as (previous: T) => T)(previous) : next);
  }, [source]);
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
export function useAtom<T extends Readable<any>>(factory: () => T): T {
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
  /** True after dispose() has released the resource. */
  readonly disposed: boolean;
  /** Explicitly starts loading outside render (route loader, event, or SSR). */
  preload(): void;
  /** Cancels an in-flight request and releases listeners. */
  dispose(): void;
  subscribe(listener: () => void): () => void;
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
  /** Resolves the promise React is suspending on when cancellation must not
   * wait for a loader that ignores its abort signal. */
  let settlePending: (() => void) | undefined;
  let disposed = false;
  const listeners = new Set<Listener>();
  const notify = () => { for (const listener of listeners) listener(); };

  const preload = () => {
    if (disposed || promise) return;
    const active = new AbortController();
    controller = active;
    const loaded = Promise.resolve().then(() => loader(active.signal)).then(
      value => { if (!disposed && controller === active && !active.signal.aborted) { status = "ready"; data = value; notify(); } },
      reason => { if (!disposed && controller === active && !active.signal.aborted) { status = "error"; error = reason; notify(); } },
    );
    // Race the load against explicit cancellation so a suspended boundary can
    // retry even when the loader never settles after abort.
    promise = Promise.race([loaded, new Promise<void>(resolve => { settlePending = resolve; })]);
    notify();
  };

  return {
    get status() { return status; },
    get data() { return data; },
    get error() { return error; },
    get disposed() { return disposed; },
    read() {
      if (!promise) throw new Error("Resource has not been preloaded. Start it outside render with resource.preload().");
      if (status === "pending") throw promise;
      if (status === "error") throw error;
      return data as T;
    },
    reload() {
      if (disposed) return;
      controller?.abort();
      settlePending?.();
      settlePending = undefined;
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
      // A Suspense boundary that already received the pending promise retries
      // the same settled promise forever once resolution is skipped. Deliver a
      // terminal error and settle the suspended promise so the boundary retries.
      if (status === "pending") {
        status = "error";
        error = new Error("Streamix resource was disposed before it settled.");
        settlePending?.();
        settlePending = undefined;
        notify();
      }
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
  const store = useMemo(() => {
    let revision = 0;
    let status = resource.status;
    let data = resource.data;
    let error = resource.error;
    const update = (): boolean => {
      if (status === resource.status && Object.is(data, resource.data) && Object.is(error, resource.error)) return false;
      status = resource.status;
      data = resource.data;
      error = resource.error;
      revision++;
      return true;
    };
    return {
      // Snapshot reads are pure, cached primitive reads. Changes are recorded
      // by notifications, including a change between render and subscribing.
      getSnapshot: () => revision,
      subscribe(notify: Listener) {
        const stop = resource.subscribe(() => { if (update()) notify(); });
        if (update()) notify();
        return stop;
      },
    };
  }, [resource]);
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
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
  const resourceSlot = useRef<{
    dependencies: readonly unknown[];
    resource: PreloadedResource<T>;
  } | null>(null);
  const previous = resourceSlot.current;
  const dependenciesChanged = previous === null ||
    previous.dependencies.length !== dependencies.length ||
    dependencies.some((dependency, index) => !Object.is(dependency, previous.dependencies[index]));
  if (previous === null || dependenciesChanged || previous.resource.disposed) {
    // A no-provider Activity hide disposes the effect-owned resource while
    // React keeps this hook slot. Recreate it for the re-shown tree instead
    // of returning a permanently pending resource.
    resourceSlot.current = {
      dependencies: dependencies.slice(),
      resource: createResource<T>(signal => loaderRef.current(signal)),
    };
  }
  const resource = resourceSlot.current!.resource;
  const lifetime = useContext(StreamixLifetimeContext);
  const previousResource = useRef<PreloadedResource<T> | null>(null);
  const [, forceRender] = useState(0);
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
    if (resource.disposed) {
      // Activity can re-show the retained tree without a render. Replace the
      // effect-owned resource here as well and let the forced render switch
      // usePreloadedResource to the replacement.
      resourceSlot.current = {
        dependencies: dependencies.slice(),
        resource: createResource<T>(signal => loaderRef.current(signal)),
      };
      forceRender(version => version + 1);
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

/** Captures current values and the final emissions of completed atoms. */
export function createAtomSnapshot(sources: Record<string, DependencySource<unknown>>): AtomSnapshot {
  const snapshot: AtomSnapshot = {};
  for (const [name, source] of Object.entries(sources)) {
    const state = readSourceState(source);
    let value: unknown;
    if (state.status === "value") {
      value = state.value;
    } else if (state.status === "completed" && "safeValue" in source) {
      // A completed Streamix flow no longer exposes .value. Its cached
      // emission is still readable, including an explicitly emitted undefined.
      value = source.safeValue;
      if (value === NO_INITIAL_VALUE) continue;
    } else {
      continue;
    }
    Object.defineProperty(snapshot, name, { value, enumerable: true, configurable: true, writable: true });
  }
  return snapshot;
}

/** Applies a validated SSR payload to named writable atoms before hydration. */
export function hydrateAtomSnapshot(
  targets: Record<string, Writable<unknown>>,
  snapshot: AtomSnapshot,
): void {
  const entries = Object.entries(snapshot);
  // Validate the whole payload before writing anything, so a bad trailing key
  // cannot leave earlier atoms partially hydrated.
  for (const [name] of entries) {
    if (!Object.prototype.hasOwnProperty.call(targets, name)) throw new Error(`Unknown atom snapshot key: ${name}`);
  }
  for (const [name, value] of entries) targets[name].next(value);
}

/** Version-2 wire encoding for one atom: JSON values stay verbatim and
 * `undefined` is tagged so its key survives serialization. */
type EncodedSnapshotAtom = { readonly t: "json"; readonly v: unknown } | { readonly t: "undefined" };

/** Rejects values JSON would silently coerce (NaN → null, Date → string, Map
 * → {}) instead of emitting a payload that hydrates different values. */
function assertSnapshotValue(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Readable snapshot is not serializable: ${path} is ${String(value)}`);
    return;
  }
  if (value === undefined) throw new Error(`Readable snapshot is not serializable: ${path} contains undefined; only a top-level atom value may be undefined`);
  if (typeof value === "bigint") throw new Error(`Readable snapshot is not serializable: ${path} is a bigint`);
  if (typeof value === "symbol" || typeof value === "function") throw new Error(`Readable snapshot is not serializable: ${path} is a ${typeof value}`);
  if (ancestors.has(value)) throw new Error(`Readable snapshot is not serializable: ${path} contains a circular reference`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Readable snapshot is not serializable: ${path} is not a plain object or array`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) assertSnapshotValue(value[index], `${path}[${index}]`, ancestors);
  } else {
    for (const [key, item] of Object.entries(value)) assertSnapshotValue(item, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function encodeSnapshotValue(name: string, value: unknown): EncodedSnapshotAtom {
  if (value === undefined) return { t: "undefined" };
  assertSnapshotValue(value, name, new Set());
  return { t: "json", v: value };
}

/** Creates a JSON-safe, versioned SSR payload from named atom snapshots.
 * Values that JSON cannot round-trip are rejected before emitting a payload. */
export function serializeAtomSnapshot(sources: Record<string, DependencySource<unknown>>): string {
  const encoded: Record<string, EncodedSnapshotAtom> = {};
  for (const [name, value] of Object.entries(createAtomSnapshot(sources))) {
    Object.defineProperty(encoded, name, { value: encodeSnapshotValue(name, value), enumerable: true, configurable: true, writable: true });
  }
  const payload = { version: 2 as const, atoms: encoded };
  let json: string | undefined;
  try {
    json = JSON.stringify(payload);
  } catch (error) {
    throw new Error(`Readable snapshot is not serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (json === undefined) throw new Error("Readable snapshot is not serializable");
  // Safe for embedding in a non-executable <script type="application/json">.
  return json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

/** Parses and validates a versioned SSR payload before client hydration.
 * Version 1 (plain JSON) payloads remain readable; version 2 restores tagged
 * `undefined` values. */
export function parseAtomSnapshot(serialized: string): AtomSnapshotPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Invalid Streamix atom snapshot JSON");
  }
  const version = typeof parsed === "object" && parsed !== null ? (parsed as { version?: unknown }).version : undefined;
  const rawAtoms = typeof parsed === "object" && parsed !== null ? (parsed as { atoms?: unknown }).atoms : undefined;
  if (
    (version !== 1 && version !== 2) ||
    typeof rawAtoms !== "object" || rawAtoms === null || Array.isArray(rawAtoms)
  ) {
    throw new Error("Invalid Streamix atom snapshot payload");
  }
  if (version === 1) return { version: 1, atoms: rawAtoms as AtomSnapshot };
  const atoms: AtomSnapshot = {};
  for (const [name, encoded] of Object.entries(rawAtoms)) {
    if (typeof encoded !== "object" || encoded === null || Array.isArray(encoded)) {
      throw new Error("Invalid Streamix atom snapshot payload");
    }
    const tag = (encoded as { t?: unknown }).t;
    if (tag === "undefined") {
      Object.defineProperty(atoms, name, { value: undefined, enumerable: true, configurable: true, writable: true });
    } else if (tag === "json" && Object.prototype.hasOwnProperty.call(encoded, "v")) {
      Object.defineProperty(atoms, name, { value: (encoded as { v: unknown }).v, enumerable: true, configurable: true, writable: true });
    } else {
      throw new Error("Invalid Streamix atom snapshot payload");
    }
  }
  return { version: 2, atoms };
}

/** Validates matching server/client atom keys, then applies the payload. */
export function hydrateAtomPayload(
  targets: Record<string, Writable<unknown>>,
  payload: AtomSnapshotPayload,
): void {
  // Sources without a capturable value leave their client targets pending.
  // Unknown payload keys indicate a server/client target mismatch.
  const unknown = Object.keys(payload.atoms)
    .filter(name => !Object.prototype.hasOwnProperty.call(targets, name))
    .sort();
  if (unknown.length > 0) {
    const expected = Object.keys(targets).sort();
    throw new Error(`Readable snapshot keys do not match hydration targets (expected: ${expected.join(", ")}; received: ${Object.keys(payload.atoms).sort().join(", ")})`);
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
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) {
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
