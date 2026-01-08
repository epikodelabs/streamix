import { createOperator, getIteratorMeta, setIteratorMeta, type MaybePromise, type Operator } from "../abstractions";
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
    const outputIterator = eachValueFrom(output);

    let buffer: {
      result: IteratorResult<T>;
      meta?: { valueId: string; operatorIndex: number; operatorName: string };
    }[] = [];

    let completed = false;

    const flush = () => {
      if (buffer.length === 0) return;

      const targetMeta = buffer[buffer.length - 1]?.meta;
      if (targetMeta) {
        setIteratorMeta(
          outputIterator,
          { valueId: targetMeta.valueId },
          targetMeta.operatorIndex,
          targetMeta.operatorName
        );
      }

      // Emit expanded value
      output.next(buffer.map((e) => e.result.value!));
      buffer = [];
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
      buffer = [];
      output.error(err);
      cleanup();
    };

    // Periodic flush
    const intervalSubscription = timer(period, period).subscribe({
      next: () => flush(),
      error: (err) => fail(err),
      complete: () => flushAndComplete(),
    });

    (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;

          buffer.push({
            result,
            meta: getIteratorMeta(source),
          });
        }
      } catch (err) {
        fail(err);
      } finally {
        flushAndComplete();
      }
    })();

    return outputIterator;
  });
}
