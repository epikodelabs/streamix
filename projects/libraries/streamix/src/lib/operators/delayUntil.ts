import {
  Atom,
  createOperator,
  DONE,
  NEXT,
  normalizeError,
  type Operator
} from "../atoms";
import { from } from "../factories";
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
 *   emitting, the gate can never open. Buffered values are discarded, the
 *   source is torn down, and the operator completes immediately.
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
 * @param notifier A `AtomBase<N>` or `Promise<N>` that gates the source.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
export function delayUntil<T = any, N = any>(
  notifier: Atom<N> | Promise<N>
): Operator<T, T> {
  return createOperator<T, T>("delayUntil", function (source: AsyncIterator<T>) {
    const notifierIt = from(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator<T | N>([
      notifierIt as AsyncIterator<T | N>,
      source as AsyncIterator<T | N>
    ]);
    const NOTIFIER_INDEX = 0;
    const SOURCE_INDEX = 1;

    const buffer: T[] = [];
    let gateOpened = false;
    let isDone = false;
    let sourceCompleted = false;

    const close = () => {
      isDone = true;
      runner.return?.().catch(() => {});
    };

    /**
     * Internal logic to handle events from the runner.
     * Returns a result if we should emit, null if we should keep pulling.
     */
    const handleEvent = (event: any): IteratorResult<T> | null => {
      if (event.type === 'error') {
        close();
        throw normalizeError(event.error);
      }

      if (event.type === 'complete') {
        if (event.sourceIndex === SOURCE_INDEX) {
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
            close();
            return DONE;
          }
          return null;
        }
      }

      if (event.sourceIndex === SOURCE_INDEX) {
        if (gateOpened) {
          // Gate is open - forward immediately
          return NEXT(event.value as T);
        } else {
          // Gate is closed - buffer
          buffer.push(event.value as T);
        }
      } else {
        // Notifier emitted - open the gate (even if it's the first and only emission)
        if (!gateOpened) {
          gateOpened = true;
          runner.removeSource(NOTIFIER_INDEX).catch(() => {});
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
            close();
            return DONE;
          }

          // 3. Pull from runner
          const result = await runner.next();
          if (result.done) {
            // Runner completed - this means both sources are done
            // Flush any remaining buffered values if gate was opened
            if (gateOpened && buffer.length > 0) {
              const flushed = this.flushOne!();
              if (flushed) return flushed;
            }
            isDone = true;
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
          close();
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
        const error = normalizeError(err);
        isDone = true;
        await runner.return?.();
        return Promise.reject(error);
      }
    };

    return iterator;
  });
}
