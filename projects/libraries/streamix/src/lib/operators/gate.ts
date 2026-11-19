import { createOperator, DONE, normalizeError } from '../atoms';
import type { PipeInput } from '../atoms/pipe';
import { from } from '../factories';
import { __streamixBeginLifetime } from '../runtime/introspection-hooks';
import { createAsyncPushable } from '../utils';

/**
 * How a gate treats source values received while it is closed.
 *
 * - `drop` (default): discard values.
 * - `latest`: retain only the most recent value and emit it on open.
 * - `buffer`: retain up to `capacity` values. When full, `overflow` decides
 *   whether to fail with a `RangeError` (default), drop the incoming value,
 *   or drop the oldest buffered value.
 */
export type GateOptions =
  | { closed?: 'drop' }
  | { closed: 'latest' }
  | { closed: 'buffer'; capacity: number; overflow?: 'drop-oldest' | 'drop-newest' | 'error' };

/**
 * Starts and stops delivery without unsubscribing from the source.
 *
 * A boolean control stream opens the gate with `true` and closes it with
 * `false`; the gate starts closed. While open, source values pass through
 * immediately. While closed, {@link GateOptions} decides whether values are
 * dropped, kept as the latest, or buffered up to a capacity. The source keeps
 * running either way — this is delivery control, not backpressure.
 *
 * Opening the gate flushes retained values in arrival order before later
 * values pass through. Buffered values are discarded if the source completes
 * while the gate is closed. The control stream may end independently: the
 * gate keeps its last state, and the output completes when the source ends.
 *
 * Admission follows event resolution order. A value and a control change that
 * resolve in the same tick are processed in the order their pulls resolve:
 * closing before the value drops it, while a value that resolves before the
 * close is admitted under the state that was current when it was pulled.
 * Under `latest`/`buffer`, a value that resolves before an opening change is
 * retained and flushed by that change.
 *
 * Errors from either stream fail the output. A `buffer` capacity that is not
 * a positive integer fails synchronously when the operator is created.
 *
 * Typical scenarios:
 *
 * - Pausing UI or log delivery while a panel is hidden, then resuming without
 *   reconnecting the source.
 * - Keeping only the newest value while paused (`closed: 'latest'`).
 * - Buffering a bounded backlog while paused and replaying it in order
 *   (`closed: 'buffer'`).
 *
 * This is not backpressure: the source is still pulled. Use {@link buffer} or
 * {@link throttle} for rate or volume control.
 *
 * @typeParam T - The type of values flowing through the gate.
 * @param control - Boolean stream that opens (`true`) or closes (`false`) the
 *   gate.
 * @param options - Behavior while closed; defaults to dropping values.
 * @returns An operator that forwards source values according to the control.
 *
 * @example
 * ```ts
 * // `source` is the value stream; `paused` emits the boolean control.
 * // Keep at most 100 values while paused, then release them in order.
 * const gated = pipe(source, gate(paused, {
 *   closed: 'buffer',
 *   capacity: 100,
 *   overflow: 'drop-oldest',
 * }));
 * ```
 */
export function gate<T = any>(control: PipeInput<boolean>, options: GateOptions = {}) {
  if (options.closed === 'buffer' && (!Number.isSafeInteger(options.capacity) || options.capacity < 1)) {
    throw new RangeError('gate capacity must be a positive integer');
  }
  return createOperator<T, T>('gate', function (this, source) {
    const controlLifetime = __streamixBeginLifetime(this);
    controlLifetime?.start();
    const output = createAsyncPushable<T>();
    const controlIt = from(control)[Symbol.asyncIterator]();
    let open = false, stopped = false;
    let pending: T[] = [];
    let controlFinished = false;
    const finishControl = (state: 'complete' | 'cancel' | 'error') => {
      if (controlFinished) return;
      controlFinished = true;
      controlLifetime?.finish(state);
    };
    const close = () => {
      if (stopped) return;
      stopped = true;
      pending = [];
      finishControl('cancel');
      void Promise.resolve(source.return?.()).catch(() => {});
      void Promise.resolve(controlIt.return?.()).catch(() => {});
    };
    const fail = (err: unknown) => { if (!stopped) { close(); output.fail(normalizeError(err)); } };
    const emit = (value: T) => { if (!stopped) output.push(value); };
    const flush = () => {
      if (!open) return;
      const values = pending; pending = [];
      for (const value of values) emit(value);
    };
    type GateEvent<V> =
      | { readonly type: 'value'; readonly value: V }
      | { readonly type: 'done' }
      | { readonly type: 'error'; readonly error: unknown };
    type StreamEvent =
      | { readonly stream: 'control'; readonly event: GateEvent<boolean> }
      | { readonly stream: 'source'; readonly event: GateEvent<T> };

    const readControl = (): Promise<StreamEvent> => controlIt.next().then(
      result => ({
        stream: 'control' as const,
        event: result.done
          ? { type: 'done' as const }
          : { type: 'value' as const, value: result.value },
      }),
      error => ({ stream: 'control' as const, event: { type: 'error' as const, error } }),
    );
    const readSource = (): Promise<StreamEvent> => source.next().then(
      result => ({
        stream: 'source' as const,
        event: result.done
          ? { type: 'done' as const }
          : { type: 'value' as const, value: result.value },
      }),
      error => ({ stream: 'source' as const, event: { type: 'error' as const, error } }),
    );

    void (async () => {
      let controlPull: Promise<StreamEvent> | undefined = readControl();
      let sourcePull: Promise<StreamEvent> | undefined = readSource();
      const never = new Promise<never>(() => {});

      try {
        while (!stopped) {
          // One coordinator observes both pulls. Whichever resolves first is
          // applied first, which makes same-tick admission deterministic.
          const winner = await Promise.race([
            controlPull ?? never,
            sourcePull ?? never,
          ]);
          if (stopped) break;

          if (winner.stream === 'control') {
            if (winner.event.type === 'error') {
              finishControl('error');
              fail(winner.event.error);
              break;
            }
            if (winner.event.type === 'done') {
              controlPull = undefined;
              finishControl('complete');
              continue;
            }
            open = Boolean(winner.event.value);
            flush();
            controlPull = readControl();
            continue;
          }

          if (winner.event.type === 'error') {
            finishControl('cancel');
            fail(winner.event.error);
            break;
          }
          if (winner.event.type === 'done') {
            sourcePull = undefined;
            pending = [];
            close();
            output.dispose();
            break;
          }

          const value = winner.event.value;
          if (open) {
            emit(value);
          } else if (options.closed === 'latest') {
            pending = [value];
          } else if (options.closed === 'buffer') {
            if (pending.length >= options.capacity) {
              switch (options.overflow ?? 'error') {
                case 'error':
                  fail(new RangeError('gate buffer capacity exceeded'));
                  break;
                case 'drop-newest':
                  break;
                case 'drop-oldest':
                  pending.shift();
                  pending.push(value);
                  break;
              }
            } else {
              pending.push(value);
            }
          }

          if (!stopped) sourcePull = readSource();
        }
      } catch (error) {
        finishControl('cancel');
        fail(error);
      }
    })();
    return {
      next: () => output.next(),
      async return() { close(); output.dispose(); return DONE; },
      async throw(error: unknown) { fail(error); throw normalizeError(error); },
    };
  });
}
