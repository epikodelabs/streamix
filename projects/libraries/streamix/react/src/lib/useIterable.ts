import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { Atom, DependencySource } from "@epikodelabs/streamix";
import { cancelDeferredDispose, deferDispose } from "./internal/deferredDispose";

type Disposable = { dispose(): void };
type Listener = () => void;

interface ExternalStore<T> {
  getSnapshot(): T;
  subscribe(listener: Listener): () => void;
}

function isDependencySource<T>(source: unknown): source is DependencySource<T> {
  if ((typeof source !== "object" && typeof source !== "function") || source === null) {
    return false;
  }

  const candidate = source as Partial<DependencySource<T>>;
  return "value" in candidate && typeof candidate.subscribe === "function";
}

function isAsyncIterable<T>(source: unknown): source is AsyncIterable<T> {
  if ((typeof source !== "object" && typeof source !== "function") || source === null) {
    return false;
  }

  return typeof (source as AsyncIterable<T>)[Symbol.asyncIterator] === "function";
}

function isDisposable(source: unknown): source is Disposable {
  return (
    (typeof source === "object" || typeof source === "function") &&
    source !== null &&
    typeof (source as Partial<Disposable>).dispose === "function"
  );
}

function createDependencyStore<T>(
  source: DependencySource<T>,
  initialValue?: T,
): ExternalStore<T> {
  return {
    getSnapshot: () => {
      const value = source.value;
      return value === undefined && initialValue !== undefined ? initialValue : value;
    },
    subscribe(listener) {
      let subscribing = true;
      const subscription = source.subscribe(() => {
        if (!subscribing) listener();
      });
      subscribing = false;
      return () => {
        void subscription();
      };
    },
  };
}

function createIterableStore<T>(source: AsyncIterable<T>, initialValue: T): ExternalStore<T> {
  let value = initialValue;
  let error: unknown;
  let hasError = false;
  let iterator: AsyncIterator<T> | null = null;
  let running = false;
  let stopToken = 0;
  const listeners = new Set<Listener>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const stop = () => {
    stopToken++;
    running = false;

    const current = iterator;
    iterator = null;

    if (current && typeof current.return === "function") {
      void current.return();
    }
  };

  const deferStop = () => {
    const token = ++stopToken;
    queueMicrotask(() => {
      if (token !== stopToken || listeners.size > 0) return;
      stop();
    });
  };

  const start = () => {
    stopToken++;
    if (running) return;

    running = true;
    error = undefined;
    hasError = false;
    const current = source[Symbol.asyncIterator]();
    iterator = current;

    void (async () => {
      try {
        while (running && iterator === current) {
          const next = await current.next();
          if (!running || iterator !== current || next.done) break;
          value = next.value;
          notify();
        }
      } catch (reason) {
        if (running && iterator === current) {
          error = reason;
          hasError = true;
          notify();
        }
      } finally {
        if (iterator === current) {
          running = false;
          iterator = null;
        }
      }
    })();
  };

  return {
    getSnapshot() {
      if (hasError) throw error;
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      start();

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) deferStop();
      };
    },
  };
}

/**
 * Reads a Streamix reactive source or any async iterable from React.
 *
 * Streamix atoms, readables, derived values, and flows take the
 * `useSyncExternalStore` path through their synchronous `value` + `subscribe`
 * contract. Plain `AsyncIterable<T>` sources are consumed directly and expose
 * their latest emitted value; those sources require an `initialValue` for the
 * first render.
 *
 * Pass a factory to make the hook own the returned source. Owned Streamix
 * atoms are disposed on unmount. Plain async iterables are stopped when React
 * unsubscribes from them.
 */
export function useIterable<T>(source: DependencySource<T>): T;
export function useIterable<T>(source: AsyncIterable<T>, initialValue: T): T;
export function useIterable<T>(factory: () => Atom<T>, initialValue?: T): T;
export function useIterable<T>(factory: () => AsyncIterable<T>, initialValue: T): T;
export function useIterable<T>(
  sourceOrFactory: DependencySource<T> | AsyncIterable<T> | (() => Atom<T> | AsyncIterable<T>),
  initialValue?: T,
): T {
  const owned = typeof sourceOrFactory === "function";
  const ownedRef = useRef<Atom<T> | AsyncIterable<T> | null>(null);

  if (owned && ownedRef.current === null) {
    ownedRef.current = (sourceOrFactory as () => Atom<T> | AsyncIterable<T>)();
  }

  const source = (owned ? ownedRef.current : sourceOrFactory) as
    | DependencySource<T>
    | AsyncIterable<T>;

  useEffect(() => {
    if (!owned || !isDisposable(source)) return;

    cancelDeferredDispose(source);
    return () => {
      deferDispose(source, () => source.dispose());
    };
  }, [owned, source]);

  const store = useMemo<ExternalStore<T>>(() => {
    if (isDependencySource<T>(source)) {
      return createDependencyStore(source, initialValue);
    }

    if (isAsyncIterable<T>(source)) {
      return createIterableStore(source, initialValue as T);
    }

    throw new TypeError("useIterable expects a Streamix source or AsyncIterable");
  }, [source, initialValue]);

  const subscribe = useCallback((listener: Listener) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}