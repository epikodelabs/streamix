import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";
import type { Coroutine } from "./shared";

/**
 * A coroutine-like operator that can process tasks asynchronously in the background.
 * Extends the base Operator interface to provide task processing capabilities
 * with proper resource cleanup.
 *
 * This interface combines the properties of a stream `Operator` with the
 * functionality of a standalone coroutine, allowing it to be used for
 * both stream transformations and direct, one-off data processing.
 *
 * @template T The type of the input value.
 * @template R The type of the output value.
 */
export interface CoroutineLike<T = any, R = T> extends Operator<T, R> {
  /**
   * Processes a single piece of data asynchronously.
   * This method allows the coroutine's logic to be called directly, outside of a stream pipeline.
   *
   * @param data The input data to be processed.
   * @returns A Promise that resolves with the processed output.
   */
  processTask: (data: T) => Promise<R>;
  /**
   * Performs any necessary cleanup and finalization logic.
   * This method is called to release resources held by the coroutine.
   *
   * @returns A Promise that resolves when finalization is complete.
   */
  finalize: () => Promise<void>;
}


/**
 * Wraps a single coroutine as a `CoroutineLike` operator.
 *
 * @template A The input type of the coroutine.
 * @template B The output type of the coroutine.
 * @param tasks A tuple containing one coroutine.
 * @returns A `CoroutineLike` operator representing the cascaded pipeline.
 */
export function cascade<A, B>(...tasks: [Coroutine<A, B>]): CoroutineLike<A, B>;

/**
 * Chains two coroutines into a single `CoroutineLike` operator.
 *
 * @template A The input type of the first coroutine.
 * @template B The output type of the first coroutine.
 * @template C The output type of the second coroutine.
 * @param tasks A tuple of two coroutines to chain.
 * @returns A `CoroutineLike` operator representing the cascaded pipeline.
 */
export function cascade<A, B, C>(
  ...tasks: [Coroutine<A, B>, Coroutine<B, C>]
): CoroutineLike<A, C>;

/**
 * Chains three coroutines into a single `CoroutineLike` operator.
 *
 * @template A The input type of the first coroutine.
 * @template B The output type of the first coroutine.
 * @template C The output type of the second coroutine.
 * @template D The output type of the third coroutine.
 * @param tasks A tuple of three coroutines to chain.
 * @returns A `CoroutineLike` operator representing the cascaded pipeline.
 */
export function cascade<A, B, C, D>(
  ...tasks: [Coroutine<A, B>, Coroutine<B, C>, Coroutine<C, D>]
): CoroutineLike<A, D>;

/**
 * Chains multiple coroutines into a single `CoroutineLike` operator (generic fallback).
 *
 * @template T The input type of the first coroutine.
 * @template R The output type of the last coroutine.
 * @param tasks An array of coroutines to chain.
 * @returns A `CoroutineLike` operator representing the cascaded pipeline.
 */
export function cascade<T = any, R = any>(
  ...tasks: Array<Coroutine<any, any>>
): CoroutineLike<T, R>;

/**
 * Chains multiple coroutine tasks sequentially, creating a single `CoroutineLike` operator.
 *
 * Each coroutine in the sequence processes the output of the previous coroutine,
 * forming a data processing pipeline. This function is useful for composing
 * complex asynchronous operations from simpler, reusable building blocks.
 *
 * The final output type of the cascade is the output type of the last coroutine in the chain.
 *
 * @template T The input type of the first coroutine.
 * @template R The output type of the last coroutine.
 * @param tasks Coroutines to chain.
 * @returns {CoroutineLike<T, R>} A `CoroutineLike` operator representing the entire cascaded pipeline.
 */
export function cascade<T = any, R = any>(
  ...tasks: Array<Coroutine<any, any>>
): CoroutineLike<T, R> {
  const getTasks = () => tasks;
  let isFinalizing = false;

  const operator = createOperator<T, R>("cascade", function (this: Operator, source) {
    let completed = false;

    return {
      async next() {
        while (true) {
          if (completed || isFinalizing) {
            return DONE;
          }

          const result = await source.next();
          if (result.done) {
            completed = true;
            await coroutineLike.finalize();
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
        await coroutineLike.finalize();
        return DONE;
      },
      async throw(err) {
        completed = true;
        await coroutineLike.finalize();
        throw err;
      }
    };
  }) as Operator<T, R>;

  const coroutineLike: CoroutineLike<T, R> = Object.assign(operator, {
    async processTask(data: T) {
      let result: any = data;
      const tasksList = getTasks();
      for (const task of tasksList) {
        result = await task.processTask(result);
      }
      return result as R;
    },
    async finalize() {
      if (isFinalizing) return;
      isFinalizing = true;
      const tasksList = getTasks();
      for (const task of tasksList) {
        await task.finalize();
      }
    }
  });

  return coroutineLike;
}



