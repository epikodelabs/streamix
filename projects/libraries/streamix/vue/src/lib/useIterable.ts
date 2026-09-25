import {
  customRef,
  getCurrentScope,
  onScopeDispose,
  type ShallowRef,
} from 'vue';
import type {
  DependencySource,
  Subscription,
} from '@epikodelabs/streamix';

type Disposable = { dispose(): void };
type ErrorSource = {
  onError(handler: (error: unknown) => void): Subscription;
};

/**
 * Read-only Vue ref returned by {@link useIterable}.
 *
 * Streamix owns the value. Vue only tracks reads and invalidates dependents
 * when the Streamix source emits.
 */
export type IterableRef<T> = Readonly<ShallowRef<T>>;

function isDependencySource<T>(source: unknown): source is DependencySource<T> {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    return false;
  }

  const candidate = source as Partial<DependencySource<T>>;
  return 'value' in candidate && typeof candidate.subscribe === 'function';
}

function isAsyncIterable<T>(source: unknown): source is AsyncIterable<T> {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    return false;
  }

  return typeof (source as AsyncIterable<T>)[Symbol.asyncIterator] === 'function';
}

function isDisposable(source: unknown): source is Disposable {
  return (
    (typeof source === 'object' || typeof source === 'function') &&
    source !== null &&
    typeof (source as Partial<Disposable>).dispose === 'function'
  );
}

function isErrorSource(source: unknown): source is ErrorSource {
  return (
    (typeof source === 'object' || typeof source === 'function') &&
    source !== null &&
    typeof (source as Partial<ErrorSource>).onError === 'function'
  );
}

function registerCleanup(cleanup: () => void): void {
  if (!getCurrentScope()) {
    return;
  }

  onScopeDispose(cleanup);
}

function readonlyBridgeRef<T>(read: () => T): {
  ref: IterableRef<T>;
  invalidate(): void;
} {
  let invalidate = () => {};

  const ref = customRef<T>((track, trigger) => {
    invalidate = trigger;

    return {
      get() {
        track();
        return read();
      },
      set() {
        throw new TypeError(
          'useIterable() returns a read-only ref. Use useWritable() for mutable Streamix state.',
        );
      },
    };
  });

  return {
    ref: ref as IterableRef<T>,
    invalidate,
  };
}

function dependencyRef<T>(
  source: DependencySource<T>,
  initialValue: T | undefined,
  owned: boolean,
): IterableRef<T> {
  const bridge = readonlyBridgeRef(() => {
    const value = source.value;
    return value === undefined && initialValue !== undefined
      ? initialValue
      : value;
  });

  let subscribing = true;
  const subscription = source.subscribe(() => {
    if (!subscribing) bridge.invalidate();
  });
  subscribing = false;
  const errorSubscription = isErrorSource(source)
    ? source.onError(() => bridge.invalidate())
    : undefined;

  registerCleanup(() => {
    void subscription();
    void errorSubscription?.();

    if (owned && isDisposable(source)) {
      source.dispose();
    }
  });

  return bridge.ref;
}

function asyncIterableRef<T>(
  source: AsyncIterable<T>,
  initialValue: T,
  owned: boolean,
): IterableRef<T> {
  let value = initialValue;
  let error: unknown;
  let failed = false;
  let active = true;

  const bridge = readonlyBridgeRef(() => {
    if (failed) {
      throw error;
    }

    return value;
  });

  const iterator = source[Symbol.asyncIterator]();

  void (async () => {
    try {
      while (active) {
        const next = await iterator.next();
        if (!active || next.done) {
          break;
        }

        value = next.value;
        failed = false;
        error = undefined;
        bridge.invalidate();
      }
    } catch (reason) {
      if (!active) {
        return;
      }

      failed = true;
      error = reason;
      bridge.invalidate();
    }
  })();

  registerCleanup(() => {
    active = false;

    if (typeof iterator.return === 'function') {
      void iterator.return();
    }

    if (owned && isDisposable(source)) {
      source.dispose();
    }
  });

  return bridge.ref;
}

/**
 * Reads a Streamix reactive source or any async iterable from Vue.
 *
 * Streamix atoms, readables, derived values, and flows use their synchronous
 * `.value` + `subscribe(...)` contract. Vue does not mirror that value into its
 * own state: the returned ref reads directly from the Streamix source and is
 * merely invalidated when the source emits.
 *
 * Plain `AsyncIterable<T>` values have no synchronous current value, so they
 * require an `initialValue`. Their latest emission is exposed through the
 * returned ref and the iterator is closed with the current Vue effect scope.
 *
 * Pass a factory to make this composable own the returned source. Owned
 * disposable Streamix sources are disposed when the current Vue effect scope
 * stops (component unmount, `effectScope().stop()`, etc.).
 */
export function useIterable<T>(source: DependencySource<T>, initialValue?: T): IterableRef<T>;
export function useIterable<T>(source: AsyncIterable<T>, initialValue: T): IterableRef<T>;
export function useIterable<T>(factory: () => DependencySource<T>, initialValue?: T): IterableRef<T>;
export function useIterable<T>(factory: () => AsyncIterable<T>, initialValue: T): IterableRef<T>;
export function useIterable<T>(
  sourceOrFactory:
    | DependencySource<T>
    | AsyncIterable<T>
    | (() => DependencySource<T> | AsyncIterable<T>),
  initialValue?: T,
): IterableRef<T> {
  const owned = typeof sourceOrFactory === 'function';
  const source = owned
    ? (sourceOrFactory as () => DependencySource<T> | AsyncIterable<T>)()
    : sourceOrFactory;

  if (isDependencySource<T>(source)) {
    return dependencyRef(source, initialValue, owned);
  }

  if (isAsyncIterable<T>(source)) {
    return asyncIterableRef(source, initialValue as T, owned);
  }

  throw new TypeError('useIterable expects a Streamix source or AsyncIterable');
}