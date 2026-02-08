import { createPushOperator, getIteratorMeta, type MaybePromise } from "../abstractions";
import { timer } from "../streams";

/**
 * Buffers values from the source stream and emits them as arrays every `period` milliseconds.
 *
 * @template T The type of the values in the source stream.
 * @param period Time in milliseconds between each buffer flush.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
export function buffer<T = any>(period: MaybePromise<number>) {
  return createPushOperator<T, T[]>("buffer", (source, output) => {
    let buf: {
      result: IteratorResult<T>;
      meta?: { valueId: string; operatorIndex: number; operatorName: string };
    }[] = [];

    let completed = false;

    const flush = () => {
      if (buf.length === 0) return;

      const targetMeta = buf[buf.length - 1]?.meta;
      const inputValueIds = buf.map((e) => e.meta?.valueId).filter(Boolean) as string[];

      const values = buf.map((e) => e.result.value!);
      output.push(values, targetMeta, {
        kind: "collapse",
        inputValueIds: inputValueIds.length > 0 ? inputValueIds : undefined,
      });
      buf = [];
    };

    let intervalSubscription: any;
    let pendingIntervalUnsubscribe = false;

    const requestIntervalUnsubscribe = (): void => {
      if (intervalSubscription) {
        const sub = intervalSubscription;
        intervalSubscription = undefined;
        sub.unsubscribe();
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
        output.complete();
      }
      cleanup();
    };

    const fail = (err: any) => {
      buf = [];
      output.error(err);
      cleanup();
    };

    intervalSubscription = timer(period, period).subscribe({
      next: () => flush(),
      error: (err) => fail(err),
      complete: () => flushAndComplete(),
    });

    if (pendingIntervalUnsubscribe) {
      requestIntervalUnsubscribe();
    }

    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;

          buf.push({ result, meta: getIteratorMeta(source) });
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
