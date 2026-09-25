import {
  computed,
  type WritableComputedRef,
} from 'vue';
import type { Writable } from '@epikodelabs/streamix';
import { useIterable } from './useIterable';

/**
 * Binds a Streamix {@link Writable} to Vue as a writable computed ref.
 *
 * Reads stay synchronized through {@link useIterable}; writes go directly to
 * the Streamix source. This makes the result work naturally with `v-model`
 * without copying Streamix state into Vue state.
 *
 * @example
 * ```ts
 * const count = useWritable(counter);
 * count.value++;
 * ```
 *
 * ```html
 * <input v-model="name">
 * ```
 */
export function useWritable<T>(source: Writable<T>): WritableComputedRef<T> {
  const current = useIterable(source);

  return computed({
    get: () => current.value,
    set: (value: T) => source.next(value),
  });
}
