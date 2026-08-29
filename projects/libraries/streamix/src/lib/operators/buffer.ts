import { createPushOperator } from "../atoms";
import { timer } from "../factories";
import { normalizeError } from "../atoms";

/**
 * Buffers values from the source stream and emits them as arrays every `period` milliseconds.
 *
 * Windows that contain no values are not emitted: a silent period produces no
 * empty-array emission. (RxJS `bufferTime` emits `[]` for empty windows; use
 * the flush timing itself only if you do not rely on empty windows.)
 *
 * @template T The type of the values in the source stream.
 * @param period Time in milliseconds between each buffer flush.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export function buffer<T>(period: number) {
  return createPushOperator<T, T[]>("buffer", (source, output) => {
    let buf: IteratorResult<T>[] = [];

    let completed = false;

    const flush = () => {
      if (buf.length === 0) return;

      const values = buf.map((e) => e.value!);
      output.push(values);
      buf = [];
    };

    let unsubscribe: any;
    let pendingIntervalUnsubscribe = false;

    const requestIntervalUnsubscribe = (): void => {
      if (unsubscribe) {
        const sub = unsubscribe;
        unsubscribe = undefined;
        sub();
        return;
      }
      pendingIntervalUnsubscribe = true;
    };

    const cleanup = () => {
      requestIntervalUnsubscribe();
    };

    const flushAndComplete = () => {
      flush();
      if (!completed) {
        completed = true;
        output.dispose();
      }
      cleanup();
    };

    const fail = (err: any) => {
      buf = [];
      output.fail(normalizeError(err));
      cleanup();
    };

    unsubscribe = timer(period, period).subscribe(() => flush());

    if (pendingIntervalUnsubscribe) {
      requestIntervalUnsubscribe();
    }

    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;

          buf.push(result);
        }
      } catch (err) {
        fail(err);
      } finally {
        flushAndComplete();
      }
    })();

    return () => {
      cleanup();
      buf = [];
    };
  });
}
