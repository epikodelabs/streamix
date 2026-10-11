import {
  customRef,
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
  // Do not wrap the bridge in `computed()`: computed refs only notify their
  // consumers when their returned value changes by Object.is. Streamix emits
  // are meaningful even when a mutable object is re-emitted by identity.
  return customRef<T>((track, trigger) => {
    return {
      get() {
        track();
        return current.value;
      },
      set(value: T) {
        source.next(value);
        // The Streamix subscription invalidates `current`; forwarding a
        // trigger here makes direct writes reliable even for same identities.
        trigger();
      },
    };
  }) as WritableComputedRef<T>;
}
