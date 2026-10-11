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
import { recordStreamixDevtoolsEvent } from './devtools';

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

/** A manually owned Vue bridge for code outside a Vue effect scope. */
export interface IterableBridge<T> {
  readonly ref: IterableRef<T>;
  /** Stops the Streamix subscription or iterator. Safe to call more than once. */
  dispose(): void;
}

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

function requireEffectScope(api: string): void {
  if (!getCurrentScope()) {
    throw new Error(
      `${api} must run inside Vue setup() or an active effectScope(). ` +
      'Use createIterableBridge() and call dispose() for manually owned usage.',
    );
  }
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
): IterableBridge<T> {
  const sourceName = 'Vue reactive source';
  const bridge = readonlyBridgeRef(() => {
    const value = source.value;
    return value === undefined && initialValue !== undefined
      ? initialValue
      : value;
  });

  let subscribing = true;
  recordStreamixDevtoolsEvent({ type: 'subscription', source: sourceName });
  const subscription = source.subscribe(() => {
    if (!subscribing) {
      bridge.invalidate();
      recordStreamixDevtoolsEvent({ type: 'write', source: sourceName });
    }
  });
  subscribing = false;
  const errorSubscription = isErrorSource(source)
    ? source.onError(() => bridge.invalidate())
    : undefined;

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    recordStreamixDevtoolsEvent({ type: 'unsubscribe', source: sourceName });
    void subscription();
    void errorSubscription?.();

    if (owned && isDisposable(source)) {
      source.dispose();
    }
  };

  return { ref: bridge.ref, dispose };
}

function asyncIterableRef<T>(
  source: AsyncIterable<T>,
  initialValue: T,
  owned: boolean,
): IterableBridge<T> {
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

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    active = false;

    if (typeof iterator.return === 'function') {
      void iterator.return();
    }

    if (owned && isDisposable(source)) {
      source.dispose();
    }
  };

  return { ref: bridge.ref, dispose };
}

/**
 * Reads a Streamix reactive source or any async iterable from Vue.
 *
 * If `source.value` is genuinely `undefined`, a supplied `initialValue` is
 * displayed instead; omit it when `undefined` itself is meaningful.
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
 *
 * This composable requires an active Vue effect scope. For manual ownership
 * outside Vue setup, use {@link createIterableBridge} and dispose it directly.
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
  requireEffectScope('useIterable()');
  const bridge = createIterableBridgeImpl(sourceOrFactory, initialValue);
  onScopeDispose(bridge.dispose);
  return bridge.ref;
}

/**
 * Creates a manually owned bridge for code outside `setup()` or an active
 * Vue effect scope. Call {@link IterableBridge.dispose} when the owner ends.
 */
export function createIterableBridge<T>(source: DependencySource<T>, initialValue?: T): IterableBridge<T>;
export function createIterableBridge<T>(source: AsyncIterable<T>, initialValue: T): IterableBridge<T>;
export function createIterableBridge<T>(factory: () => DependencySource<T>, initialValue?: T): IterableBridge<T>;
export function createIterableBridge<T>(factory: () => AsyncIterable<T>, initialValue: T): IterableBridge<T>;
export function createIterableBridge<T>(
  sourceOrFactory:
    | DependencySource<T>
    | AsyncIterable<T>
    | (() => DependencySource<T> | AsyncIterable<T>),
  initialValue?: T,
): IterableBridge<T> {
  return createIterableBridgeImpl(sourceOrFactory, initialValue);
}

function createIterableBridgeImpl<T>(
  sourceOrFactory:
    | DependencySource<T>
    | AsyncIterable<T>
    | (() => DependencySource<T> | AsyncIterable<T>),
  initialValue?: T,
): IterableBridge<T> {
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
