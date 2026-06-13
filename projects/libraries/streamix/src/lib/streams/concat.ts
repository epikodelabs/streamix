import { flow, type AtomBase } from "../atoms/atom";
import { toAsyncIterable, type StreamInput } from "./pipe";

/**
 * Concatenates sources sequentially.
 *
 * `concat(a, b, c)` subscribes to `a`, yields all its values, waits for it to
 * complete, then moves to `b`, then `c`.
 *
 * - If any source errors, the concatenated atom errors and remaining sources
 *   are not processed.
 * - Sources may be atoms, streams, raw values, arrays/iterables, or Promises of those.
 *
 * @template T Value type.
 * @param sources Atoms, streams, or values (including promises) to concatenate.
 * @returns {AtomBase<T | undefined>} A new atom that emits values from all input sources in order.
 *
 * @example
 * const s = concat(from([1, 2]), from([3]), 4);
 * // emits: 1, 2, 3, 4
 */

export function concat<T = any>(...sources: StreamInput<T>[]): AtomBase<T | undefined> {
  return flow<T | undefined>(async function* () {
    for (const source of sources) {
      const iterator = toAsyncIterable(source)[Symbol.asyncIterator]() as AsyncIterator<T>;

      try {
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          yield result.value;
        }
      } finally {
        // Attempt to close iterator early on abort or completion
        if (iterator.return) {
          try {
            await iterator.return(undefined);
          } catch {
            // ignore
          }
        }
      }
    }
  });
}
