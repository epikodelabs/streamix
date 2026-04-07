import {
    createOperator,
    DONE,
    DROPPED,
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
 * values are forwarded normally.
 *
 * Values suppressed before the gate opens are yielded with `dropped: true` so
 * that backpressure is released and downstream operators can observe the
 * suppressed emissions.
 *
 * Important details:
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, the operator remains closed and continues to drop source values.
 * - Error propagation: errors from either the notifier or source are propagated
 *   to the output and will terminate the subscription.
 *
 * @template T Source/output value type.
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `Stream<N>` or `Promise<N>` that opens the gate when it emits.
 * @returns An `Operator<T, T>` that drops source values until the notifier emits.
 */
export function skipUntil<T = any, N = any>(
  notifier: Stream<any, N> | Promise<N>
): Operator<T, T> {
  return createOperator<T, T>("skipUntil", function (source: AsyncIterator<T>) {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator([source, notifierIt]);

    let gateOpened = false;
    let droppingBacklog = false;
    let isDone = false;

    const handleEvent = (event: any): IteratorResult<T> | null => {
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

      if (event.sourceIndex === 1) {
        // Notifier emitted: open the gate
        if (!gateOpened) {
          gateOpened = true;
          droppingBacklog = !!(source as any).__hasBufferedValues?.();
        }
        return null;
      }

      // Source value (sourceIndex === 0)
      if (gateOpened && droppingBacklog) {
        // Drop values that were already buffered before the gate opened.
        droppingBacklog = !!(source as any).__hasBufferedValues?.();
        return DROPPED(event.value) as any;
      }

      if (gateOpened) {
        return { done: false, value: event.value };
      }

      // Gate not yet open — yield as dropped so backpressure is released.
      return DROPPED(event.value) as any;
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

          const out = handleEvent(result.value);
          if (out) return out;
        }
      },

      __tryNext() {
        if (isDone) return DONE;

        while (runner.__hasBufferedValues?.()) {
          const res = runner.__tryNext?.();
          if (!res || res.done) break;

          const out = handleEvent(res.value);
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
