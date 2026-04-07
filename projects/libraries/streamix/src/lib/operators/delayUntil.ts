import {
    createOperator,
    DONE,
    type Operator,
    type Stream
} from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

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
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `Stream<N>` or `Promise<N>` that gates the source.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
export function delayUntil<T = any, N = any>(
  notifier: Stream<any, N> | Promise<N>
): Operator<T, T> {
  return createOperator<T, T>("delayUntil", function (source: AsyncIterator<T>) {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator([notifierIt, source]);

    const buffer: T[] = [];
    let gateOpened = false;
    let isDone = false;
    let sourceCompleted = false;

    /**
     * Internal logic to handle events from the runner.
     * Returns a result if we should emit, null if we should keep pulling.
     */
    const handleEvent = (event: any): IteratorResult<T> | null => {
      if (event.type === 'error') {
        isDone = true;
        throw event.error;
      }

      if (event.type === 'complete') {
        if (event.sourceIndex === 1) {
          // Source completed
          sourceCompleted = true;
          if (gateOpened) {
            // If gate is open, flush remaining buffer on next iteration
            return null;
          }
          // Gate closed: keep buffered values and wait for notifier.
          return null;
        } else {
          // Notifier completed without ever emitting - discard buffer
          if (!gateOpened) {
            buffer.length = 0;
            isDone = true;
            return DONE;
          }
          return null;
        }
      }

      if (event.sourceIndex === 1) {
        if (gateOpened) {
          // Gate is open - forward immediately
          return { done: false, value: event.value };
        } else {
          // Gate is closed - buffer
          buffer.push(event.value);
        }
      } else {
        // Notifier emitted - open the gate (even if it's the first and only emission)
        if (!gateOpened) {
          gateOpened = true;
          // Immediately try to flush one buffered value
          return iterator.flushOne!();
        }
      }
      return null;
    };

    const iterator: AsyncIterator<T> & {
      __tryNext?: () => IteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
      flushOne?: () => IteratorResult<T> | null;
    } = {
      async next() {
        if (isDone) return DONE;

        while (true) {
          // 1. Always check the buffer first if the gate is open
          if (gateOpened) {
            const flushed = this.flushOne!();
            if (flushed) return flushed;
          }

          // 2. If source completed and gate opened, but buffer is empty, we're done
          if (sourceCompleted && gateOpened && buffer.length === 0) {
            isDone = true;
            return DONE;
          }

          // 3. Pull from runner
          const result = await runner.next();
          if (result.done) {
            // Runner completed - this means both sources are done
            isDone = true;
            // Flush any remaining buffered values if gate was opened
            if (gateOpened && buffer.length > 0) {
              const flushed = this.flushOne!();
              if (flushed) return flushed;
            }
            return DONE;
          }

          const out = handleEvent(result.value);
          if (out) return out;
        }
      },

      __tryNext: () => {
        if (isDone) return DONE;

        // 1. Try flushing buffer if gate is open
        if (gateOpened) {
          const flushed = iterator.flushOne!();
          if (flushed) return flushed;
        }

        // 2. If source completed and gate opened, but buffer is empty
        if (sourceCompleted && gateOpened && buffer.length === 0) {
          isDone = true;
          return DONE;
        }

        // 3. Try draining sync events from runner
        while (runner.__hasBufferedValues?.()) {
          const res = runner.__tryNext?.();
          if (!res || res.done) break;

          const out = handleEvent(res.value);
          if (out) return out;
          
          // After handling an event, check buffer again
          if (gateOpened) {
            const flushed = iterator.flushOne!();
            if (flushed) return flushed;
          }
        }

        return isDone ? DONE : null;
      },

      flushOne() {
        if (!gateOpened || buffer.length === 0) return null;
        const value = buffer.shift()!;
        return { done: false, value };
      },

      __hasBufferedValues: () => 
        (gateOpened && buffer.length > 0) || (runner.__hasBufferedValues?.() ?? false),

      async return(value) {
        isDone = true;
        await runner.return?.();
        return value !== undefined ? { value, done: true } : DONE;
      },

      async throw(err) {
        isDone = true;
        await runner.throw?.(err);
        return Promise.reject(err);
      }
    };

    return iterator;
  });
}
