import { NO_INITIAL_VALUE, type DependencySource } from '@epikodelabs/streamix';

/** @internal Sentinel identity used by compiler-generated SSR guards. */
export const ɵsxNoInitialValue = NO_INITIAL_VALUE;

/** Pending framework values are undefined; the core sentinel is never view data. */
export function viewValue<T>(value: T): T {
  return value === NO_INITIAL_VALUE ? undefined as T : value;
}

/** Avoid evaluating expressions with unavailable dependencies (e.g. symbol + text). */
export function readViewExpression<T>(sources: readonly DependencySource<unknown>[], read: () => T): T {
  if (sources.some(source => source.value === NO_INITIAL_VALUE)) return undefined as T;
  return viewValue(read());
}
