import { __streamixBeginLifetime, type StreamixLifetimeSpan } from '../runtime/introspection';
import { SerialInnerExecution } from '../runtime/serial-inner-execution';
import { createOperator, DONE, isPromiseLike, NEXT, type MaybePromise, type Operator } from "../atoms";
import type { Atom } from "../atoms/atom";
import { from } from '../factories';
import { normalizeError } from "../atoms";

/**
 * Result type accepted from a fork handler. Includes stream/atom/iterable/promise
 * and scalar values, but excludes iterables/atoms from the scalar branch so that
 * TypeScript infers the emitted element type rather than the wrapper type.
 */
type ForkHandlerResult<R> =
  | Atom<R>
  | AsyncIterable<R>
  | Iterable<R>
  | MaybePromise<R>;

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
   * - an {@link Atom<R>}
   * - an {@link AsyncIterable<R>}
   * - an {@link Iterable<R>} (including arrays)
   * - a {@link MaybePromise<R>}
   *
   * @param value The source value that matched the predicate.
   * @returns A stream, atom, iterable, promise, or scalar to be flattened and emitted.
   */
  handler: (value: T) => ForkHandlerResult<R>;
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
    const inner = new SerialInnerExecution<R>();
    let lifetime: StreamixLifetimeSpan | undefined;
    const operator = this;

    const iterator: AsyncIterator<R> = {
      next: async () => {
        try {
          while (true) {
            if (inner.stopped) return DONE;
            // If no active inner iterator, get next outer value
            if (!inner.active) {
              const result = await source.next();
              if (inner.stopped) return DONE;
              if (result.done) {
                return DONE;
              }

              lifetime = __streamixBeginLifetime(operator);
              lifetime?.start();
              let matched: typeof resolvedOptions[number] | undefined;
              const outerValue = result.value;
              const currentIndex = outerIndex++;

              for (const option of resolvedOptions) {
                const predicateResult = option.on(outerValue, currentIndex);
                const matches = isPromiseLike(predicateResult) ? await predicateResult : predicateResult;
                if (inner.stopped) return DONE;
                if (matches) {
                  matched = option;
                  break;
                }
              }

              if (!matched) {
                throw new Error(`No handler found for value: ${outerValue}`);
              }

              const innerStream = from(matched.handler(outerValue));
              inner.attach(innerStream[Symbol.asyncIterator]() as AsyncIterator<R>);
            }

            // Pull next inner value
            const innerResult = await inner.next();
            if (inner.stopped) return DONE;
            if (innerResult.done) {
              lifetime?.finish('complete');
              continue;
            }

            lifetime?.output();
            return NEXT(innerResult.value);
          }
        } catch (error) {
          lifetime?.finish('error');
          void inner.close();
          throw error;
        }
      },

      async return(_value?: any) {
        lifetime?.finish('cancel');
        try {
          await inner.close();
        } catch {}
        try {
          await source.return?.();
        } catch {}
        return DONE;
      },

      async throw(err: any) {
        lifetime?.finish('error');
        const error = normalizeError(err);
        try {
          await inner.close();
        } catch {}
        try {
          await source.return?.();
        } catch {}
        throw error;
      }
    };

    return iterator;
  });
