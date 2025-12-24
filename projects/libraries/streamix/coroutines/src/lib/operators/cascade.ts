import { createOperator, DONE, isPromiseLike, type MaybePromise, NEXT, type Operator } from "@epikode/streamix";
import type { Coroutine } from "./coroutine";

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


export function cascade<A, B>(...tasks: [MaybePromise<Coroutine<A, B>>]): CoroutineLike<A, B>;

export function cascade<A, B, C>(
  ...tasks: [MaybePromise<Coroutine<A, B>>, MaybePromise<Coroutine<B, C>>]
): CoroutineLike<A, C>;

export function cascade<A, B, C, D>(
  ...tasks: [MaybePromise<Coroutine<A, B>>, MaybePromise<Coroutine<B, C>>, MaybePromise<Coroutine<C, D>>]
): CoroutineLike<A, D>;


export function cascade<T = any, R = any>(
  ...tasks: Array<MaybePromise<Coroutine<any, any>>>
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
  ...tasks: Array<MaybePromise<Coroutine<any, any>>>
): CoroutineLike<T, R> {
  let cachedTasks: Coroutine<any, any>[] | null = null;
  const getTasks = async () => {
    if (cachedTasks === null) {
      const resolvedTasks = await Promise.all(tasks.map(async (task) => {
        const resolved = isPromiseLike(task) ? await task : task;
        return Array.isArray(resolved) ? resolved : [resolved];
      }));
      cachedTasks = resolvedTasks.flat();
    }
    return cachedTasks;
  };

  const operator = createOperator<T, R>("cascade", function (this: Operator, source) {
    let completed = false;

    return {
      async next() {
        while (true) {
          if (completed) {
            return DONE;
          }

          const result = await source.next();
          if (result.done) {
            completed = true;
            return DONE;
          }

          let taskResult: any = result.value;
          const resolvedTasks = await getTasks();
          for (const task of resolvedTasks) {
            taskResult = await task.processTask(taskResult);
          }

          return NEXT(taskResult);
        }
      },
      async return() {
        completed = true;
        return DONE;
      },
      async throw(err) {
        completed = true;
        throw err;
      }
    };
  }) as Operator<T, R>;

  const coroutineLike: CoroutineLike<T, R> = Object.assign(operator, {
    async processTask(data: T) {
      let result: any = data;
      const tasksList = await getTasks();
      for (const task of tasksList) {
        result = await task.processTask(result);
      }
      return result as R;
    },
    async finalize() {
      const tasksList = await getTasks();
      for (const task of tasksList) {
        await task.finalize();
      }
    }
  });

  return coroutineLike;
}


