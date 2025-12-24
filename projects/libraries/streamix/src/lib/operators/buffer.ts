import { createOperator, type MaybePromise, type Operator } from "../abstractions";
import { eachValueFrom } from "../converters";
import { timer } from "../streams";
import { createSubject } from "../subjects";

/**
 * Buffers values from the source stream and emits them as arrays every `period` milliseconds,
 * while tracking pending and phantom values in the PipeContext.
 *
 * @template T The type of the values in the source stream.
 * @param period Time in milliseconds between each buffer flush.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export function buffer<T = any>(period: MaybePromise<number>) {
  return createOperator<T, T[]>("buffer", function (this: Operator, source) {
    const output = createSubject<T[]>();
    let buffer: IteratorResult<T>[] = [];
    let completed = false;

    const flush = () => {
      if (buffer.length > 0) {
        // Emit an array of the actual values
        const values = buffer.map((r) => r.value!);
        output.next(values);

        // Resolve all pending results for this flush
        buffer = [];
      }
    };

    const cleanup = () => {
      intervalSubscription.unsubscribe();
    };

    const flushAndComplete = () => {
      flush();
      if (!completed) {
        completed = true;
        output.complete();
      }
      cleanup();
    };

    const fail = (err: any) => {
      // resolve all pending before error
      if (buffer.length > 0) {
        buffer = [];
      }
      output.error(err);
      cleanup();
    };

    // Timer triggers periodic flush
    const intervalSubscription = timer(period, period).subscribe({
      next: () => flush(),
      error: (err) => fail(err),
      complete: () => flushAndComplete(),
    });

    (async () => {
      try {
        while (true) {
          const result: IteratorResult<T> = await source.next();
          if (result.done) break;

          // Add to buffer
          buffer.push(result);
        }
      } catch (err) {
        cleanup();
        output.error(err);
      } finally {
        flushAndComplete();
      }
    })();

    return eachValueFrom(output);
  });
}
