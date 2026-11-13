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
    const close = () => {
      if (stopped) return;
      stopped = true;
      pending = [];
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
    void (async () => {
      try {
        while (!stopped) {
          const item = await controlIt.next();
          if (stopped || item.done) break;
          open = Boolean(item.value);
          flush();
        }
        controlLifetime?.finish(stopped ? 'cancel' : 'complete');
      } catch (error) { controlLifetime?.finish('error'); fail(error); }
    })();
    void (async () => {
      try {
        while (!stopped) {
          const item = await source.next();
          if (stopped || item.done) break;
          if (open) { emit(item.value); continue; }
          if (options.closed === 'latest') pending = [item.value];
          else if (options.closed === 'buffer') {
            if (pending.length >= options.capacity) {
              switch (options.overflow ?? 'error') {
                case 'error': throw new RangeError('gate buffer capacity exceeded');
                case 'drop-newest': continue;
                case 'drop-oldest': pending.shift(); break;
              }
            }
            pending.push(item.value);
          }
        }
        if (!stopped) { pending = []; close(); output.dispose(); }
      } catch (error) { fail(error); }
    })();
    return {
      next: () => output.next(),
      async return() { close(); output.dispose(); return DONE; },
      async throw(error: unknown) { fail(error); throw normalizeError(error); },
    };
  });
}
