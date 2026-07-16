import { createOperator, DONE, NEXT, isPromiseLike } from '@epikodelabs/streamix';

/**
 * Creates a stream operator that computes the arithmetic mean of values from the source stream.
 *
 * The operator consumes every value, optionally maps it through the provided `selector`,
 * keeps running totals and counts, and emits the average once the source stream completes.
 * When the source produces no values, it still completes and emits `0`.
 *
 * @template T The type of the values in the source stream.
 * @param selector Optional function that projects each value to a number; it receives the value and its index
 * and may return a promise. Defaults to interpreting the value itself as a number.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method. The operator emits exactly
 * one numeric value before completing every subscription.
 */
const average = (selector = (value) => value) => createOperator("average", function (source) {
    let total = 0;
    let count = 0;
    let index = 0;
    let emitted = false;
    return {
        async next() {
            if (emitted)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    emitted = true;
                    const averageValue = count === 0 ? 0 : total / count;
                    return NEXT(averageValue);
                }
                const selected = selector(result.value, index++);
                const value = isPromiseLike(selected) ? await selected : selected;
                total += value;
                count++;
            }
        },
    };
});

/**
 * Creates a stream operator that counts the number of items emitted by the source stream.
 *
 * This operator consumes every value from the source without emitting until the
 * upstream completes. After the source finishes, it emits exactly one number:
 * the total count of consumed values (zero if nothing arrived), and then the
 * operator completes.
 *
 * @template T The type of the values in the source stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const count = () => createOperator("count", function (source) {
    let counted = false;
    let total = 0;
    return {
        async next() {
            if (counted)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    counted = true;
                    return NEXT(total);
                }
                total++;
            }
        },
    };
});

/**
 * Creates a stream operator that tests if all values from the source stream satisfy a predicate.
 *
 * This operator consumes the source stream and applies the provided `predicate` function
 * to each value.
 * - If the `predicate` returns a truthy value for every element until the source stream
 * completes, the operator emits `true`.
 * - If the `predicate` returns a falsy value for any element, the operator immediately
 * emits `false` and then completes, effectively "short-circuiting" the evaluation.
 *
 * This is a "pull-based" equivalent of `Array.prototype.every` and is useful for validating
 * data streams. The operator will emit only a single boolean value before it completes.
 * When the stream completes without emitting any items, it still emits `true`.
 *
 * @template T The type of the values in the source stream.
 * @param predicate The function to test each value. It receives the value and its index.
 * It can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const every = (predicate) => createOperator("every", function (source) {
    let index = 0;
    let emitted = false;
    return {
        next: async () => {
            if (emitted)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    emitted = true;
                    return NEXT(true);
                }
                const predicateResult = predicate(result.value, index++);
                const passes = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
                if (!passes) {
                    emitted = true;
                    return NEXT(false);
                }
            }
        },
    };
});

/**
 * Creates a stream operator that emits the maximum value from the source stream.
 *
 * This terminal operator consumes every downstream value, retains the current maximum
 * as data flows through, and waits for the source to complete before emitting the winner.
 * A comparator can be provided to override the default `>` comparison; asynchronous comparators
 * are supported because they are awaited internally.
 * The operator emits once with the maximum value (if any values were provided) and then completes.
 * For empty sources it returns `DONE` without emitting.
 *
 * @template T The type of the values in the source stream.
 * @param comparator Optional comparison function: positive if `a > b`, negative if `a < b`.
 * @returns An `Operator` instance usable in a stream's `pipe` method.
 */
const max = (comparator) => createOperator("max", function (source) {
    let maxValue;
    let hasMax = false;
    let emitted = false;
    return {
        next: async () => {
            if (emitted)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    emitted = true;
                    if (hasMax) {
                        return NEXT(maxValue);
                    }
                    return DONE;
                }
                const value = result.value;
                if (!hasMax) {
                    maxValue = value;
                    hasMax = true;
                    continue;
                }
                const cmpResult = comparator ? comparator(value, maxValue) : (value > maxValue ? 1 : -1);
                const cmp = isPromiseLike(cmpResult) ? await cmpResult : cmpResult;
                if (cmp > 0) {
                    maxValue = value;
                }
            }
        },
    };
});

/**
 * Creates a stream operator that emits the smallest value produced by the source stream.
 *
 * This terminal operator consumes every value, retaining the minimum seen so far as the stream progresses.
 * A comparator may be provided to customize how values are ordered (asynchronous comparators are supported).
 * Once the source completes, the minimum is emitted exactly once; empty sources result in `DONE` without emission.
 *
 * @template T The type of the values in the source stream.
 * @param comparator Optional comparison function. It should return a negative number when `a < b`, zero when equal,
 * and a positive number when `a > b`. Defaults to the `<` operator.
 * @returns An `Operator` instance usable in a stream's `pipe` method.
 */
const min = (comparator) => createOperator("min", function (source) {
    let minValue;
    let hasMin = false;
    let emitted = false;
    return {
        next: async () => {
            if (emitted)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    emitted = true;
                    if (hasMin) {
                        return NEXT(minValue);
                    }
                    return DONE;
                }
                const value = result.value;
                if (!hasMin) {
                    minValue = value;
                    hasMin = true;
                    continue;
                }
                const cmpResult = comparator ? comparator(value, minValue) : (value < minValue ? -1 : 1);
                const cmp = isPromiseLike(cmpResult) ? await cmpResult : cmpResult;
                if (cmp < 0) {
                    minValue = value;
                }
            }
        },
    };
});

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
const mode = (keySelector) => createOperator("mode", function (source) {
    const frequencies = new Map();
    let emitted = false;
    return {
        async next() {
            if (emitted)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    if (frequencies.size === 0) {
                        emitted = true;
                        return DONE;
                    }
                    let maxCount = 0;
                    for (const entry of frequencies.values()) {
                        maxCount = Math.max(maxCount, entry.count);
                    }
                    const modes = [];
                    for (const entry of frequencies.values()) {
                        if (entry.count === maxCount) {
                            modes.push(entry.value);
                        }
                    }
                    emitted = true;
                    return NEXT(modes);
                }
                const keyResult = keySelector ? keySelector(result.value) : result.value;
                const key = isPromiseLike(keyResult) ? await keyResult : keyResult;
                const existing = frequencies.get(key);
                if (existing) {
                    existing.count += 1;
                }
                else {
                    frequencies.set(key, { value: result.value, count: 1 });
                }
            }
        },
    };
});

/**
 * Creates a stream operator that tests if no values from the source stream satisfy a predicate.
 *
 * This operator consumes the stream and applies the provided `predicate` to each value.
 * - If the predicate returns truthy for any element, the operator immediately emits `false`
 *   and completes, short-circuiting the evaluation.
 * - If the source completes without the predicate ever returning truthy, the operator emits `true`.
 *
 * It mirrors `Array.prototype.every` with the predicate inverted and emits a single boolean value.
 * Empty streams also emit `true`.
 *
 * @template T The type of the values in the source stream.
 * @param predicate Function to test each value. It receives the value and its index, and it can be synchronous or async.
 * @returns An `Operator` instance usable in a stream's `pipe` method.
 */
const none = (predicate) => createOperator("none", function (source) {
    let evaluated = false;
    let index = 0;
    return {
        async next() {
            if (evaluated)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    evaluated = true;
                    return NEXT(true);
                }
                const predicateResult = predicate(result.value, index++);
                const passes = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
                if (passes) {
                    evaluated = true;
                    return NEXT(false);
                }
            }
        },
    };
});

/**
 * Creates a stream operator that tests if at least one value from the source stream satisfies a predicate.
 *
 * This operator consumes the source stream and applies the provided `predicate` function
 * to each value.
 * - If the `predicate` returns a truthy value for any element, the operator immediately
 * emits `true` and then completes, effectively "short-circuiting" the evaluation.
 * - If the source stream completes without the `predicate` ever returning a truthy value,
 * the operator emits `false`.
 *
 * This is a "pull-based" equivalent of `Array.prototype.some` and is useful for validating
 * data streams. The operator will emit only a single boolean value before it completes.
 * Streams that never satisfy the predicate emit `false` (including empty sources).
 *
 * @template T The type of the values in the source stream.
 * @param predicate The function to test each value. It receives the value and its index.
 * It can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const some = (predicate) => createOperator('some', function (source) {
    let evaluated = false;
    let index = 0;
    return {
        next: async () => {
            if (evaluated) {
                return DONE;
            }
            while (true) {
                const result = await source.next();
                if (result.done) {
                    evaluated = true;
                    return NEXT(false);
                }
                const predicateResult = predicate(result.value, index++);
                if (isPromiseLike(predicateResult) ? await predicateResult : predicateResult) {
                    evaluated = true;
                    return NEXT(true);
                }
            }
        }
    };
});

/**
 * Creates a stream operator that sums values from the source stream.
 *
 * The operator consumes every value, optionally transforms it through the provided `selector`,
 * and accumulates the sum. After the source completes, it emits the final total and completes.
 * When there are no values, it emits `0`.
 *
 * @template T The type of the values in the source stream.
 * @param selector Optional function that maps each value into a number. It receives the value and its index,
 * and can be synchronous or asynchronous. Defaults to treating each value as a number directly.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const sum = (selector = (value) => value) => createOperator("sum", function (source) {
    let total = 0;
    let index = 0;
    let emitted = false;
    return {
        async next() {
            if (emitted)
                return DONE;
            while (true) {
                const result = await source.next();
                if (result.done) {
                    emitted = true;
                    return NEXT(total);
                }
                const selected = selector(result.value, index++);
                const value = isPromiseLike(selected) ? await selected : selected;
                total += value;
            }
        },
    };
});

/**
 * Creates a stream operator that emits only distinct values from the source stream.
 *
 * This operator maintains an internal set of values or keys that it has already emitted.
 * For each new value from the source, it checks if it has been seen before. If not,
 * the value is emitted and added to the set; otherwise, it is skipped.
 *
 * The uniqueness check can be based on the value itself or on a key derived from
 * the value using a provided `keySelector` function. This makes it ideal for de-duplicating
 * streams of primitive values or complex objects.
 * Duplicate values are dropped quietly, so the operator may emit fewer values than the source.
 *
 * @template T The type of the values in the source stream.
 * @template K The type of the key used for comparison.
 * @param keySelector An optional function to derive a unique key from each value.
 * If not provided, the values themselves are used for comparison.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
const unique = (keySelector) => createOperator("unique", function (source) {
    const seen = new Set();
    return {
        next: async () => {
            while (true) {
                const result = await source.next();
                if (result.done) {
                    return DONE;
                }
                const selectedKey = keySelector ? keySelector(result.value) : result.value;
                const key = isPromiseLike(selectedKey) ? await selectedKey : selectedKey;
                if (!seen.has(key)) {
                    seen.add(key);
                    return NEXT(result.value);
                }
            }
        }
    };
});

/*
 * Public API Surface of streamix aggregates
 */

/**
 * Generated bundle index. Do not edit.
 */

export { average, count, every, max, min, mode, none, some, sum, unique };
//# sourceMappingURL=epikodelabs-streamix-aggregates.mjs.map
