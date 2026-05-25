import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";
import { coroutine } from "../abstractions/coroutine";
import type { WorkerScript } from "../worker/types";

/**
 * Creates a reusable worker operator from a task function.
 *
 * The returned operator runs each upstream value through a SIMD worker pool.
 * The pool is created on the first subscription and finalized when the stream
 * completes, errors, or is cancelled.
 *
 * @example
 * ```ts
 * const worker = compute((x: number) => x * 2);
 * of(1, 2, 3).pipe(worker).subscribe(console.log); // 2, 4, 6
 * ```
 */
export function compute<T = any, R = any>(
  script: WorkerScript<T, R>
): Operator<T, R>;
export function compute<T = any, R = any>(
  main: (data: T) => R | Promise<R>,
  ...functions: Function[]
): Operator<T, R>;
export function compute<T = any, R = any>(
  arg1: WorkerScript<T, R> | ((data: T) => R | Promise<R>),
  ...rest: Function[]
): Operator<T, R> {
  const main = typeof arg1 === "function" ? arg1 : arg1.main;
  const functions = typeof arg1 === "function" ? rest : (arg1.functions || []);

  const worker = coroutine<T, R>(main, ...functions);

  return createOperator<T, R>("compute", function (source) {
    let finalized = false;

    return {
      next: async () => {
        if (finalized) return DONE;
        const result = await source.next();
        if (result.done) {
          finalized = true;
          await worker.finalize();
          return DONE;
        }
        try {
          const taskResult = await worker.processTask(result.value as T);
          return NEXT(taskResult);
        } catch (err) {
          finalized = true;
          await worker.finalize();
          throw err;
        }
      },
      async return() {
        finalized = true;
        await worker.finalize();
        return DONE;
      },
      async throw(err) {
        finalized = true;
        await worker.finalize();
        throw err;
      },
    };
  });
}
