import {
  createOperator,
  getIteratorMeta,
  setIteratorMeta,
  setValueMeta,
  type Operator,
  type Stream,
} from "../abstractions";
import { fromAny } from "../converters";
import { createSubject } from "../subjects";

type BufferRecord<T> = {
  result: IteratorResult<T>;
  meta?: { valueId: string; operatorIndex: number; operatorName: string };
};

/**
 * Buffers values until the notifier emits once, then flushes the collected values.
 *
 * Every notifier emission triggers a flush of the current buffer; values are released
 * as a collapsed array, preserving metadata for PipeContext tracing. When the source
 * completes, any remaining buffered values are emitted.
 *
 * @template T Source value type.
 * @param notifier Stream or Promise whose emissions cause buffer flushes.
 */
export const bufferUntil = <T = any>(notifier: Stream<any>) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source) {
    const output = createSubject<T[]>();
    const buffer: BufferRecord<T>[] = [];
    const notifierIterator = fromAny(notifier)[Symbol.asyncIterator]();
    let cancelled = false;

    // Create the output iterator once so metadata sticks
    const outputIt = output[Symbol.asyncIterator]();

    const flushBuffer = () => {
      if (buffer.length === 0) return;

      const records = buffer.splice(0);
      const metas = records
        .map((record) => record.meta)
        .filter(Boolean) as {
        valueId: string;
        operatorIndex: number;
        operatorName: string;
      }[];

      const lastMeta = metas[metas.length - 1];
      let values = records.map((record) => record.result.value!);

      if (lastMeta) {
        setIteratorMeta(
          iterator,
          {
            valueId: lastMeta.valueId,
            kind: "collapse",
            inputValueIds: metas.map((meta) => meta.valueId),
          },
          lastMeta.operatorIndex,
          lastMeta.operatorName
        );
        values = setValueMeta(
          values,
          {
            valueId: lastMeta.valueId,
            kind: "collapse",
            inputValueIds: metas.map((meta) => meta.valueId),
          },
          lastMeta.operatorIndex,
          lastMeta.operatorName
        );
      }

      output.next(values);
    };

    // Notifier loop - flush on each emission
    (async () => {
      try {
        while (!cancelled) {
          const result = await notifierIterator.next();
          if (result.done || cancelled) break;
          queueMicrotask(() => flushBuffer());
        }
      } catch (err) {
        if (!cancelled) {
          output.error(err);
        }
      }
    })();

    // Source loop - buffer values
    (async () => {
      try {
        while (!cancelled) {
          const result = await source.next();
          if (result.done || cancelled) break;
          buffer.push({
            result,
            meta: getIteratorMeta(source),
          });
        }

        if (!cancelled) {
          flushBuffer();
          output.complete();
        }
      } catch (err) {
        if (!cancelled) {
          output.error(err);
        }
      } finally {
        if (!cancelled) {
          try {
            await notifierIterator.return?.();
          } catch {}
        }
      }
    })();

    // Custom iterator with cleanup
    const iterator: AsyncIterator<T[]> = {
      next: () => outputIt.next(),
      return: async (value?: any) => {
        cancelled = true;

        // Cleanup source iterator
        try {
          await source.return?.();
        } catch {}

        // Cleanup notifier iterator
        try {
          await notifierIterator.return?.();
        } catch {}

        output.complete();
        return outputIt.return?.(value) ?? { done: true as const, value };
      },
      throw: async (error?: any) => {
        cancelled = true;
        output.error(error);
        return outputIt.throw?.(error) ?? Promise.reject(error);
      },
    };

    return iterator;
  });
