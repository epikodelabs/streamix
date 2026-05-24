import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";
import type { Coroutine } from "../worker/types";

/**
 * Wraps a single coroutine as a `Coroutine` operator.
 *
 * @template A The input type of the coroutine.
 * @template B The output type of the coroutine.
 * @param tasks A tuple containing one coroutine.
 * @returns A `Coroutine` operator representing the composed pipeline.
 */
export function compose<A, B>(...tasks: [Coroutine<A, B>]): Coroutine<A, B>;

/**
 * Chains two coroutines into a single `Coroutine` operator.
 *
 * @template A The input type of the first coroutine.
 * @template B The output type of the first coroutine.
 * @template C The output type of the second coroutine.
 * @param tasks A tuple of two coroutines to chain.
 * @returns A `Coroutine` operator representing the composed pipeline.
 */
export function compose<A, B, C>(
  ...tasks: [Coroutine<A, B>, Coroutine<B, C>]
): Coroutine<A, C>;

/**
 * Chains three coroutines into a single `Coroutine` operator.
 *
 * @template A The input type of the first coroutine.
 * @template B The output type of the first coroutine.
 * @template C The output type of the second coroutine.
 * @template D The output type of the third coroutine.
 * @param tasks A tuple of three coroutines to chain.
 * @returns A `Coroutine` operator representing the composed pipeline.
 */
export function compose<A, B, C, D>(
  ...tasks: [Coroutine<A, B>, Coroutine<B, C>, Coroutine<C, D>]
): Coroutine<A, D>;

/**
 * Chains multiple coroutines into a single `Coroutine` operator (generic fallback).
 *
 * @template T The input type of the first coroutine.
 * @template R The output type of the last coroutine.
 * @param tasks An array of coroutines to chain.
 * @returns A `Coroutine` operator representing the composed pipeline.
 */
export function compose<T = any, R = any>(
  ...tasks: Array<Coroutine<any, any>>
): Coroutine<T, R>;

/**
 * Chains multiple coroutine tasks sequentially, creating a single `Coroutine` operator.
 *
 * Each coroutine in the sequence processes the output of the previous coroutine,
 * forming a data processing pipeline. This function is useful for composing
 * complex asynchronous operations from simpler, reusable building blocks.
 *
 * The final output type of the compose is the output type of the last coroutine in the chain.
 *
 * @template T The input type of the first coroutine.
 * @template R The output type of the last coroutine.
 * @param tasks Coroutines to chain.
 * @returns {Coroutine<T, R>} A `Coroutine` operator representing the entire composed pipeline.
 */
export function compose<T = any, R = any>(
  ...tasks: Array<Coroutine<any, any>>
): Coroutine<T, R> {
  const getTasks = () => tasks;
  let finalizePromise: Promise<void> | null = null;

  const operator = createOperator<T, R>("compose", function (this: Operator, source) {
    let completed = false;

    return {
      async next() {
        while (true) {
          if (completed || finalizePromise) {
            return DONE;
          }

          const result = await source.next();
          if (result.done) {
            completed = true;
            await coroutine.finalize();
            return DONE;
          }

          let taskResult: any = result.value;
          const resolvedTasks = getTasks();
          for (const task of resolvedTasks) {
            taskResult = await task.processTask(taskResult);
          }

          return NEXT(taskResult);
        }
      },
      async return() {
        completed = true;
        await coroutine.finalize();
        return DONE;
      },
      async throw(err) {
        completed = true;
        await coroutine.finalize();
        throw err;
      }
    };
  }) as Operator<T, R>;

  const coroutine: Coroutine<T, R> = Object.assign(operator, {
    async processTask(data: T) {
      let result: any = data;
      const tasksList = getTasks();
      for (const task of tasksList) {
        result = await task.processTask(result);
      }
      return result as R;
    },
    async finalize() {
      if (finalizePromise) return finalizePromise;

      finalizePromise = (async () => {
        const tasksList = getTasks();
        const errors: Error[] = [];

        for (const task of tasksList) {
          try {
            await task.finalize();
          } catch (error) {
            errors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }

        if (errors.length === 1) {
          throw errors[0];
        }
        if (errors.length > 1) {
          throw new AggregateError(errors, "compose finalization failed");
        }
      })();

      return finalizePromise;
    }
  });

  return coroutine;
}
