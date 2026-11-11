import { createOperator, DONE, NEXT, normalizeError, type Operator } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from "../factories";
import { createAsyncCoordinator } from "../utils";
import { asStreamixSource } from "../utils/source-protocol";
import type { SourceCapabilities, SyncPoll } from "../utils/source-protocol";

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
 * @param notifier A `AtomBase<N>` or `Promise<N>` that opens the gate when it emits.
 * @returns An `Operator<T, T>` that drops source values until the notifier emits.
 */
export function skipUntil<T = any, N = any>(
  notifier: PipeInput<N> | Promise<N>
): Operator<T, T> {
  return createOperator<T, T>("skipUntil", function (source: AsyncIterator<T>) {
    const notifierIt = from(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator<T | N>([
      source as AsyncIterator<T | N>,
      notifierIt as AsyncIterator<T | N>
    ]);
    const SOURCE_INDEX = 0;
    const NOTIFIER_INDEX = 1;

    let gateOpened = false;
    let droppingBacklog = false;
    let isDone = false;

    const close = () => {
      isDone = true;
      runner.return?.().catch(() => {});
    };

    const handleEvent = (event: any): IteratorResult<T> | null => {
      if (event.type === 'error') {
        close();
        throw normalizeError(event.error);
      }

      if (event.type === 'complete') {
        if (event.sourceIndex === SOURCE_INDEX) {
          close();
          return DONE;
        }
        // Notifier completing without emission is handled by gateOpened remaining false
        return null;
      }

      if (event.sourceIndex === NOTIFIER_INDEX) {
        // Notifier emitted: open the gate
        if (!gateOpened) {
          gateOpened = true;
          // Only values already held by the source count as backlog; the
          // protocol's `hasBufferedEvents` deliberately excludes both the
          // terminal state and lazily producible values.
          droppingBacklog = asStreamixSource(source).hasBufferedEvents?.() ?? false;
          runner.removeSource(NOTIFIER_INDEX).catch(() => {});
        }
        return null;
      }

      // Source value
      if (gateOpened && droppingBacklog) {
        // Drop values that were already buffered before the gate opened.
        droppingBacklog = asStreamixSource(source).hasBufferedEvents?.() ?? false;
        return null;
      }

      if (gateOpened) {
        return NEXT(event.value as T);
      }

      // Gate not yet open — skip this value and continue waiting.
      return null;
    };

    const iterator: AsyncIterator<T> & SourceCapabilities<T> = {
      async next() {
        if (isDone) return DONE;

        while (true) {
          // 1. Try sync drain
          const sync = this.pollSync?.();
          if (sync?.status === 'available') return sync.result;

          // 2. Wait for runner
          const result = await runner.next();
          if (result.done) {
            isDone = true;
            return DONE;
          }

          const out = handleEvent(result.value);
          if (out) return out;
        }
      },

      pollSync(): SyncPoll<T> {
        if (isDone) return { status: "available", result: DONE };

        while (true) {
          const poll = runner.pollSync();
          if (poll.status === 'unavailable') break;
          if (poll.result.done) {
            isDone = true;
            return { status: "available", result: DONE };
          }

          const out = handleEvent(poll.result.value);
          if (out) return { status: "available", result: out };
        }
        return isDone ? { status: "available", result: DONE } : { status: "unavailable" };
      },

      hasBufferedEvents: () => runner.hasBufferedEvents?.() ?? false,

      isTerminal: () => isDone,

      async return(value) {
        isDone = true;
        await runner.return?.();
        return value !== undefined ? { value, done: true } : DONE;
      }
    };

    return iterator;
  });
}
