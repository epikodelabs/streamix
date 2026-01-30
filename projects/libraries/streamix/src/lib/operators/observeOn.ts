import { createOperator, DONE, getIteratorMeta, isPromiseLike, setIteratorMeta, setValueMeta, type MaybePromise, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject } from '../subjects';

/**
 * Creates a stream operator that schedules the emission of each value from the source
 * stream on a specified JavaScript task queue.
 *
 * This operator is a scheduler. It decouples the timing of value production from
 * its consumption, allowing you to control when values are emitted to downstream
 * operators. This is essential for preventing long-running synchronous operations
 * from blocking the main thread and for prioritizing different types of work.
 *
 * The operator supports three contexts:
 * - `"microtask"`: Emits the value at the end of the current task using `queueMicrotask`.
 * - `"macrotask"`: Emits the value in the next event loop cycle using `setTimeout(0)`.
 * - `"idle"`: Emits the value when the browser is idle using `requestIdleCallback`.
 *
 * @template T The type of the values in the source and output streams.
 * @param context The JavaScript task queue context to schedule emissions on.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */

/**
 * Creates a stream operator that schedules the emission of each value from the source
 * stream on a specified JavaScript task queue.
 *
 * This operator is a scheduler. It decouples the timing of value production from
 * its consumption, allowing you to control when values are emitted to downstream
 * operators. This is essential for preventing long-running synchronous operations
 * from blocking the main thread and for prioritizing different types of work.
 *
 * The operator supports three contexts:
 * - `"microtask"`: Emits the value at the end of the current task using `queueMicrotask`.
 * - `"macrotask"`: Emits the value in the next event loop cycle using `setTimeout(0)`.
 * - `"idle"`: Emits the value when the browser is idle using `requestIdleCallback`.
 *
 * @template T The type of the values in the source and output streams.
 * @param context The JavaScript task queue context to schedule emissions on.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const observeOn = <T = any>(context: MaybePromise<"microtask" | "macrotask" | "idle">) => {
  return createOperator<T, T>('observeOn', function (this: Operator, source) {
    const output = createSubject<T>();
    const outputIterator = eachValueFrom(output);
    const scheduledPromises: Promise<void>[] = [];

    (async () => {
      try {
        const contextValue = isPromiseLike(context) ? await context : context;
        const schedule = contextValue === 'microtask'
          ? (fn: () => void) => queueMicrotask(fn)
          : contextValue === 'macrotask'
            ? (fn: () => void) => setTimeout(fn, 0)
            : (fn: () => void) => requestIdleCallback(fn);

        while (true) {
          const result = await source.next();
          if (result.done) break;
          const meta = getIteratorMeta(source);

          const p = new Promise<void>((resolve) => {
            schedule(() => {
              try {
                let value = result.value;
                if (meta) {
                  setIteratorMeta(
                    outputIterator,
                    { valueId: meta.valueId },
                    meta.operatorIndex,
                    meta.operatorName
                  );
                  value = setValueMeta(value, { valueId: meta.valueId }, meta.operatorIndex, meta.operatorName);
                }
                output.next(value);
              } finally {
                resolve();
              }
            });
          });
          scheduledPromises.push(p);
        }

        // Wait for all scheduled emissions before completing
        await Promise.all(scheduledPromises);
      } catch (err) {
        output.error(err);
      } finally {
        if (!output.completed()) output.complete();
      }
    })();

    let completed = false;

    return {
      async next() {
        while (true) {
          if (completed) return DONE;

          const result = await outputIterator.next();
          if (result.done) {
            completed = true;
            return DONE;
          }
          return { type: 'next', value: result.value };
        }
      }
    };
  });
};
