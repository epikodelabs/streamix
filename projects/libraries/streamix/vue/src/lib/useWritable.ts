import {
  customRef,
  type Ref,
} from 'vue';
import type { Writable } from '@epikodelabs/streamix';
import { useIterable } from './useIterable';

/**
 * Binds a Streamix {@link Writable} to Vue as a writable ref.
 *
 * Reads stay synchronized through {@link useIterable}; writes go directly to
 * the Streamix source. This makes the result work naturally with `v-model`
 * without copying Streamix state into Vue state. The source subscription is
 * the only invalidation path for direct writes, so a synchronous watcher runs
 * once per emission.
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
export function useWritable<T>(source: Writable<T>, sourceName?: string): Ref<T> {
  const current = useIterable(source, undefined, sourceName);
  // Do not wrap the bridge in `computed()`: computed refs only notify their
  // consumers when their returned value changes by Object.is. Streamix emits
  // are meaningful even when a mutable object is re-emitted by identity.
  return customRef<T>((track) => {
    return {
      get() {
        track();
        return current.value;
      },
      set(value: T) {
        // The synchronous Streamix subscription invalidates `current` for
        // every emission, including same-identity writes. Triggering this
        // outer ref as well would notify sync watchers twice per write.
        source.next(value);
      },
    };
  });
}
