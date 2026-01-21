import {
  createOperator,
  getIteratorMeta,
  setIteratorMeta,
  setValueMeta,
  type Operator,
  type Stream,
} from "../abstractions";
import { eachValueFrom, fromAny } from "../converters";
import { createSubject } from "../subjects";

type BufferRecord<T> = {
  result: IteratorResult<T>;
  meta?: { valueId: string; operatorIndex: number; operatorName: string };
};

/**
 * Buffers values until the notifier emits once, then flushes the collected values.
 *
 * Every notifier emission triggers a flush of the current buffer; values are released
 * as a collapsed array, preserving metadata for PipeContext tracing. When `flushOnComplete`
 * is true the last buffered items are emitted after the source completes.
 *
 * @template T Source value type.
 * @param notifier Stream or Promise whose emissions cause buffer flushes.
 * @param flushOnComplete Emit the remaining buffer when the source completes.
 */
export const bufferUntil = <T = any>(
  notifier: Stream<any>
) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source) {
    const output = createSubject<T[]>();
    const outputIterator = eachValueFrom(output);

    const buffer: BufferRecord<T>[] = [];
    const notifierIterator = fromAny(notifier)[Symbol.asyncIterator]();

    const flushBuffer = () => {
      if (buffer.length === 0) return;

      const records = buffer.splice(0);
      const metas = records
        .map((record) => record.meta)
        .filter(Boolean) as { valueId: string; operatorIndex: number; operatorName: string }[];

      const lastMeta = metas[metas.length - 1];
      let values = records.map((record) => record.result.value!);

      if (lastMeta) {
        setIteratorMeta(
          outputIterator,
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
          { valueId: lastMeta.valueId, kind: "collapse", inputValueIds: metas.map((meta) => meta.valueId) },
          lastMeta.operatorIndex,
          lastMeta.operatorName
        );
      }

      output.next(values);
    };

    (async () => {
      try {
        while (true) {
          const result = await notifierIterator.next();
          if (result.done) break;
          queueMicrotask(() => flushBuffer());
        }
      } catch (err) {
        output.error(err);
      }
    })();

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

        flushBuffer();
        output.complete();
      } catch (err) {
        output.error(err);
      } finally {
        notifierIterator.return?.();
      }
    })();

    return outputIterator;
  });
