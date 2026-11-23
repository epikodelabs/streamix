import { createOperator, DONE, isPromiseLike, NEXT, type MaybePromise, type Operator, type Stream } from "../abstractions";
import { fromAny } from '../converters';
import { normalizeError } from '../utils/helpers';
import { createDisposer } from '../utils/disposal';
import { raceNext } from '../utils/coordinator';

/**
 * Represents a conditional branch for the `fork` operator.
 *
 * Each `ForkOption` defines:
 * 1. A predicate function `on` to test source values.
 * 2. A handler function `handler` that produces a stream (or value/array/promise) when the predicate matches.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the handler and output stream.
 */
export interface ForkOption<T = any, R = any> {
  /**
   * Predicate function to determine if this option should handle a value.
   *
   * @param value The value from the source stream.
   * @param index The zero-based index of the value in the source stream.
   * @returns A boolean or a `Promise<boolean>` indicating whether this option matches.
   */
  on: (value: T, index: number) => MaybePromise<boolean>;

  /**
   * Handler function called for values that match the predicate.
   *
   * Can return:
   * - a {@link Stream<R>}
   * - a {@link MaybePromise<R>}
   * - an array of `R`
   *
   * @param value The source value that matched the predicate.
   * @returns A stream, value, promise, or array to be flattened and emitted.
   */
  handler: (value: T) => MaybePromise<Stream<R> | R | Array<R>>;
}

/**
 * Creates a stream operator that routes each source value through a specific handler
 * based on matching predicates defined in the provided `ForkOption`s.
 *
 * For each value from the source stream:
 * 1. Iterates over the `options` array.
 * 2. Executes the `on` predicate for each option until one returns `true`.
 * 3. Calls the corresponding `handler` for the first matching option.
 * 4. Flattens the result (stream, value, promise, or array) sequentially into the output stream.
 *
 * If no predicate matches a value, an error is thrown.
 *
 * This operator allows conditional branching in streams based on the content of each item.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the output stream.
 * @param options {@link ForkOption} objects defining predicates and handlers.
 * @returns An {@link Operator} instance suitable for use in a stream's `pipe` method.
 *
 * @throws {Error} If a source value does not match any predicate.
 */
export const fork = <T = any, R = any>(...options: Array<ForkOption<T, R>>) =>
  createOperator<T, R>('fork', function (this: Operator, source) {
    const resolvedOptions = options;

    let outerIndex = 0;
    let innerIterator: AsyncIterator<R> | null = null;

    const controller = new AbortController();
    const { signal } = controller;
    const close = createDisposer(queue => {
      controller.abort();
      const inner = innerIterator;
      innerIterator = null;
      queue.run(async () => { try { await inner?.return?.(); } catch {} });
      queue.run(async () => { try { await source.return?.(); } catch {} });
    });

    return {
      async next() {
        try {
          while (!signal.aborted) {
            if (!innerIterator) {
              const result = await raceNext(source, signal);
              if (result.done || signal.aborted) return DONE;

              let matched: ForkOption<T, R> | undefined;
              const outerValue = result.value;
              const currentIndex = outerIndex++;
              for (const option of resolvedOptions) {
                const predicate = option.on(outerValue, currentIndex);
                const matches = isPromiseLike(predicate)
                  ? (await raceNext({ next: async () => NEXT(await predicate) }, signal)).value
                  : predicate;
                if (signal.aborted) return DONE;
                if (matches) {
                  matched = option;
                  break;
                }
              }

              if (!matched) throw new Error(`No handler found for value: ${outerValue}`);
              const output = fromAny<R>(matched.handler(outerValue))[Symbol.asyncIterator]();
              if (signal.aborted) {
                await output.return?.();
                return DONE;
              }
              innerIterator = output;
            }

            const result = await raceNext(innerIterator, signal);
            if (signal.aborted) return DONE;
            if (!result.done) return NEXT(result.value);
            innerIterator = null;
          }
          return DONE;
        } catch (error) {
          void close();
          throw normalizeError(error);
        }
      },

      async return() {
        await close();
        return DONE;
      },

      async throw(error: unknown) {
        await close();
        throw normalizeError(error);
      },
    };
  });
