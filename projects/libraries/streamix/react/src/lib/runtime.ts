import {
  useCallback,
  useEffect,
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

function isDisposable(value: unknown): value is Disposable {
  return (typeof value === "object" || typeof value === "function") && value !== null &&
    typeof (value as Partial<Disposable>).dispose === "function";
}

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
  const subscribe = useCallback((notify: Listener) => {
    recordStreamixDevtoolsEvent({ type: "subscription", source: "explicit atom read" });
    const subscription = source.subscribe(() => {
      recordStreamixDevtoolsEvent({ type: "write", source: "explicit atom read" });
      notify();
    });
    return () => {
      recordStreamixDevtoolsEvent({ type: "unsubscribe", source: "explicit atom read" });
      void subscription();
    };
  }, [source]);
  const getSnapshot = useCallback(() => source.value, [source]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  recordStreamixDevtoolsEvent({ type: "read", source: "explicit atom read" });
  return value;
}

/** React-style value/setter binding for a writable atom. */
export function useWritable<T>(source: Writable<T>): [T, (value: T) => void] {
  const value = useAtomValue(source);
  const setValue = useCallback((next: T) => source.next(next), [source]);
  return [value, setValue];
}

/**
 * Creates a component-owned atom once per mounted component instance.
 * Factories must be render-pure: React may invoke them for an abandoned or
 * Strict-Mode development render. The owned atom is disposed after unmount.
 */
export function useAtom<T extends Atom<any>>(factory: () => T): T {
  const instance = useRef<T | null>(null);
  if (instance.current === null) instance.current = factory();

  useEffect(() => {
    const owned = instance.current!;
    return () => {
      queueMicrotask(() => {
        if (isDisposable(owned)) owned.dispose();
      });
    };
  }, []);

  return instance.current;
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
    promise = loader(active.signal).then(
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
export function useResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  dependencies: readonly unknown[],
): Resource<T> {
  const state = useRef<{ status: ResourceStatus; data?: T; error?: unknown; promise: Promise<void> }>({
    status: "pending",
    promise: Promise.resolve(),
  });
  const revision = useRef(0);
  const listeners = useRef(new Set<Listener>());
  const controller = useRef<AbortController | null>(null);

  const notify = () => { for (const listener of listeners.current) listener(); };
  const start = useCallback(() => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const token = ++revision.current;
    const next = { status: "pending" as const, promise: Promise.resolve() };
    state.current = next;
    next.promise = loader(active.signal).then(
      value => { if (token === revision.current && !active.signal.aborted) { state.current = { status: "ready", data: value, promise: next.promise }; notify(); } },
      error => { if (token === revision.current && !active.signal.aborted) { state.current = { status: "error", error, promise: next.promise }; notify(); } },
    );
    notify();
  // Caller controls loader identity through dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    start();
    return () => controller.current?.abort();
  }, [start]);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const getVersion = useCallback(() => state.current, []);
  useSyncExternalStore(subscribe, getVersion, getVersion);

  return {
    get status() { return state.current.status; },
    get data() { return state.current.data; },
    get error() { return state.current.error; },
    read() {
      const current = state.current;
      if (current.status === "pending") throw current.promise;
      if (current.status === "error") throw current.error;
      return current.data as T;
    },
    reload: start,
  };
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
    if (!(name in targets)) throw new Error(`Unknown atom snapshot key: ${name}`);
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
