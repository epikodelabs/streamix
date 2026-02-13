import {
  createOperator,
  DONE,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  type Operator,
  type Stream
} from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

/**
 * Skip source values until a notifier emits.
 *
 * `skipUntil` suppresses (drops) source values until the provided `notifier`
 * produces its first emission. After the notifier emits, subsequent source
 * values are forwarded normally. Uses stamp-based filtering to ensure correct
 * ordering between notifier and source events.
 *
 * Important details:
 * - Ordering and stamps: when the gate opens (notifier emits) only source
 *   values whose stamp is strictly greater than the gate-opening stamp will be
 *   forwarded. This prevents forwarding values that were logically emitted
 *   before or concurrently with the notifier signal.
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, the operator remains closed and continues to drop source values.
 * - Error propagation: errors from either the notifier or source are propagated
 *   to the output and will terminate the subscription.
 *
 * Common uses:
 * - Ignore initial values until a readiness signal arrives.
 * - Wait for user interaction before processing inputs.
 *
 * @template T Source/output value type.
 * @template R Notifier value type (ignored by this operator).
 * @param notifier A `Stream<R>` or `Promise<R>` that opens the gate when it emits.
 * @returns An `Operator<T, T>` that drops source values until the notifier emits.
 */
export function skipUntil<T = any, R = any>(
  notifier: Stream<R> | Promise<R>
): Operator<T, T> {
  return createOperator<T, T>("skipUntil", function (source: AsyncIterator<T>) {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator([source, notifierIt]);

    let gateOpened = false;
    let gateStamp: number | null = null;
    let isDone = false;

    const handleEvent = (event: any, target: any): IteratorResult<T> | null => {
      if (event.type === 'error') {
        isDone = true;
        throw event.error;
      }

      if (event.type === 'complete') {
        if (event.sourceIndex === 0) {
          isDone = true;
          return DONE;
        }
        // Notifier completing without emission is handled by gateOpened remaining false
        return null;
      }

      const stamp = getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp();

      if (event.sourceIndex === 1) {
        // Notifier emitted: open the gate and record the stamp
        if (!gateOpened) {
          gateOpened = true;
          gateStamp = stamp;
        }
        return null;
      }

      // Source value (sourceIndex === 0)
      if (gateOpened && gateStamp !== null && stamp > gateStamp) {
        setIteratorEmissionStamp(target, stamp);
        return { done: false, value: event.value };
      }

      return null; // Skip/drop value
    };

    const iterator: AsyncIterator<T> & {
      __tryNext?: () => IteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
    } = {
      async next() {
        if (isDone) return DONE;

        while (true) {
          // 1. Try sync drain
          const sync = this.__tryNext?.();
          if (sync) return sync;

          // 2. Wait for runner
          const result = await runner.next();
          if (result.done) return DONE;

          const out = handleEvent(result.value, iterator);
          if (out) return out;
        }
      },

      __tryNext() {
        if (isDone) return DONE;

        while (runner.__hasBufferedValues?.()) {
          const res = runner.__tryNext?.();
          if (!res || res.done) break;

          const out = handleEvent(res.value, iterator);
          if (out) return out;
        }
        return isDone ? DONE : null;
      },

      __hasBufferedValues: () => runner.__hasBufferedValues?.() ?? false,

      async return(value) {
        isDone = true;
        await runner.return?.();
        return value !== undefined ? { value, done: true } : DONE;
      }
    };

    return iterator;
  });
}
