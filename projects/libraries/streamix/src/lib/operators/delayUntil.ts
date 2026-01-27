import {
  createOperator,
  DONE,
  getIteratorEmissionStamp,
  NEXT,
  setIteratorEmissionStamp,
  type Operator,
  type Stream
} from "../abstractions";
import { fromAny } from "../converters";
import { createSubject } from "../subjects";

/**
 * Delay values from the source until a notifier emits.
 *
 * This operator buffers every value produced by the source stream and releases
 * them only after the provided `notifier` produces its first emission. After the
 * notifier emits, the operator flushes the buffered values and forwards all
 * subsequent source values immediately.
 *
 * Important semantics:
 * - Buffering: values are buffered until the notifier emits, then flushed in order
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, buffered values are discarded and the operator will not forward
 *   any buffered values (it simply waits for the source to continue/complete).
 * - Error propagation: any error from the notifier or source is propagated to
 *   the output (the operator records the error and terminates the output
 *   iterator accordingly).
 *
 * Use-cases:
 * - Delay producing values until an initialization step completes (e.g. wait
 *   for a connection or configuration event).
 * - Gate values until user interaction or external readiness signal occurs.
 *
 * @template T Source/output value type.
 * @template R Notifier value type (ignored by this operator).
 * @param notifier A `Stream<R>` or `Promise<R>` that gates the source.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
export function delayUntil<T = any, R = any>(
  notifier: Stream<R> | Promise<R>
): Operator<T, T> {
  return createOperator<T, T>("delayUntil", (source) => {
    const output = createSubject<T>();
    const outputIt = output[Symbol.asyncIterator]();
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();

    const buffer: Array<{ value: T; stamp: number }> = [];
    let gateOpened = false;
    let cancelled = false;
    let resolveSourceLoop: (() => void) | null = null;

    // Flush buffered values when gate opens
    const flushBuffer = () => {
      if (buffer.length === 0) return;

      for (const { value, stamp } of buffer) {
        setIteratorEmissionStamp(outputIt as any, stamp);
        output.next(value);
      }
      buffer.length = 0;
    };

    // Notifier observer - wait for first emission to open gate
    (async () => {
      try {
        const result = await notifierIt.next();
        if (!result.done && !cancelled) {
          gateOpened = true;
          // Flush synchronously so buffered values come before new source values
          flushBuffer();
          // Wake up the source loop if it was waiting
          if (resolveSourceLoop) {
            const resolve = resolveSourceLoop as any;
            resolveSourceLoop = null;
            resolve();
          }
        }
        // Close notifier iterator after first emission or completion
        try {
          await notifierIt.return?.();
        } catch {}
      } catch (err) {
        if (!cancelled) {
          output.error(err);
        }
      }
    })();

    // Source producer
    (async () => {
      try {
        while (!cancelled) {
          const r = await source.next();
          if (r.done || cancelled) break;

          const stamp = getIteratorEmissionStamp(source) ?? 0;

          if (gateOpened) {
            // Gate is open, forward immediately
            setIteratorEmissionStamp(outputIt as any, stamp);
            output.next(r.value);
          } else {
            // Gate is closed, buffer the value
            buffer.push({ value: r.value, stamp });
          }
        }

        // Source completed - flush if gate is open, otherwise discard buffer
        if (!cancelled && gateOpened) {
          flushBuffer();
        }

        if (!cancelled) {
          output.complete();
        }
      } catch (err) {
        if (!cancelled) {
          output.error(err);
        }
      } finally {
        if (!cancelled) {
          try {
            await notifierIt.return?.();
          } catch {}
        }
      }
    })();

    // Custom iterator with cleanup
    const iterator: AsyncIterator<T> = {
      next: () => outputIt.next(),
      return: async (value?: any) => {
        cancelled = true;

        // Cleanup source iterator
        try {
          await source.return?.();
        } catch {}

        // Cleanup notifier iterator
        try {
          await notifierIt.return?.();
        } catch {}

        output.complete();

        if (value !== undefined) {
          return NEXT(value);
        }

        return DONE;
      },
      throw: async (error?: any) => {
        cancelled = true;
        output.error(error);
        return outputIt.throw?.(error) ?? Promise.reject(error);
      },
    };

    return iterator;
  });
}
