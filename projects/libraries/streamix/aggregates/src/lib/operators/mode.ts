import { createOperator, DONE, isPromiseLike, NEXT, type MaybePromise, type Operator } from "@epikodelabs/streamix";

/**
 * Emits the most frequently occurring value(s) sampled from the source stream.
 *
 * Values are keyed (optionally via `keySelector`) and counted as the stream flows through.
 * After the source completes, the operator emits all values whose count matches the maximum frequency.
 * Empty streams result in `DONE` without emission.
 *
 * @template T The type of values emitted downstream.
 * @template K The type of the key used for tracking counts.
 * @param keySelector Optional function that derives a key from each value; it may return a promise.
 * If omitted, the values themselves act as keys.
 * @returns An `Operator` instance that emits an array of the most-frequent items before completing.
 */
export const mode = <T = any, K = any>(
  keySelector?: (value: T) => MaybePromise<K>
) =>
  createOperator<T, T[]>("mode", function (this: Operator, source) {
    const frequencies = new Map<K | T, { value: T; count: number }>();
    let emitted = false;

    return {
      async next() {
        if (emitted) return DONE;

        while (true) {
          const result = await source.next();
          if (result.done) break;

          const keyResult = keySelector ? keySelector(result.value) : result.value;
          const key = isPromiseLike(keyResult) ? await keyResult : keyResult;

          const existing = frequencies.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            frequencies.set(key, { value: result.value, count: 1 });
          }
        }

        if (frequencies.size === 0) {
          return DONE;
        }

        let maxCount = 0;
        for (const entry of frequencies.values()) {
          maxCount = Math.max(maxCount, entry.count);
        }

        const modes: T[] = [];
        for (const entry of frequencies.values()) {
          if (entry.count === maxCount) {
            modes.push(entry.value);
          }
        }

        emitted = true;
        return NEXT(modes);
      },
    };
  });
