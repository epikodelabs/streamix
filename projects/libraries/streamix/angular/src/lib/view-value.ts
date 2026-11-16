import { NO_INITIAL_VALUE, type DependencySource, type Subscription } from '@epikodelabs/streamix';

/** @internal Sentinel identity used by compiler-generated SSR guards. */
export const ɵsxNoInitialValue = NO_INITIAL_VALUE;

/** Pending framework values are undefined; the core sentinel is never view data. */
export function viewValue<T>(value: T): T {
  return value === NO_INITIAL_VALUE ? undefined as T : value;
}

/**
 * Subscribes to a source's failures when it exposes the atom error channel.
 * Foreign sources without onError return undefined: they have no failure
 * notification, and their failed reads are delivered where they are read.
 */
export function subscribeSourceError(
  source: DependencySource<unknown>,
  handler: (error: unknown) => void,
): Subscription | undefined {
  if (typeof (source as { onError?: unknown }).onError !== "function") return undefined;
  const onError = (source as unknown as { onError(handler: (error: unknown) => void): Subscription }).onError;
  return onError.call(source, handler);
}

/** Combines value and error subscriptions into one teardown. */
export function combineSubscriptions(...subscriptions: (Subscription | undefined)[]): Subscription {
  const live = subscriptions.filter((subscription): subscription is Subscription => subscription !== undefined);
  const combined = (): void => {
    for (const subscription of live) subscription();
  };
  return Object.assign(combined, {
    get unsubscribed(): boolean {
      return live.every(subscription => subscription.unsubscribed);
    },
  });
}

/**
 * Framework delivery contract, shared with the React and Vue adapters: a
 * failed source read delivers its error through Angular's ErrorHandler,
 * pending reads stay undefined, and a completed source (`disposed` without
 * an error) keeps its last emission — completion is never failure.
 */
export type SxSourceState =
  | { status: "value"; value: unknown }
  | { status: "pending" }
  | { status: "completed" }
  | { status: "failed"; error: unknown };

export function readSourceState(source: DependencySource<unknown>): SxSourceState {
  // `disposed && error !== undefined` is the only failure discriminator for a
  // terminated atom; a disposed atom without an error completed normally.
  const disposed = (source as { disposed?: unknown }).disposed === true;
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
 * Evaluates a compiled expression only when every dependency can produce a
 * value. Pending dependencies yield undefined; a failed dependency delivers
 * its stored error so the framework's error handling sees it.
 */
export function readViewExpression<T>(sources: readonly DependencySource<unknown>[], read: () => T): T {
  for (const source of sources) {
    const state = readSourceState(source);
    if (state.status === "pending") return undefined as T;
    if (state.status === "failed") throw state.error;
  }
  return viewValue(read());
}
