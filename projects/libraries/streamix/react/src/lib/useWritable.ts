import { useCallback } from "react";
import type { Writable } from "@epikodelabs/streamix";
import { useIterable } from "./useIterable";

export type WritableBinding<T> = [value: T, setValue: (value: T) => void];

/**
 * Binds a Streamix {@link Writable} to React as a `[value, setValue]` pair.
 *
 * Reads stay synchronized through {@link useIterable}; writes go directly to
 * the Streamix source, so React never owns or mirrors the state.
 *
 * @example
 * ```tsx
 * const [count, setCount] = useWritable(counter);
 * <button onClick={() => setCount(count + 1)}>{count}</button>
 * ```
 */
export function useWritable<T>(source: Writable<T>): WritableBinding<T> {
  const value = useIterable(source);
  const setValue = useCallback((next: T) => source.next(next), [source]);
  return [value, setValue];
}
