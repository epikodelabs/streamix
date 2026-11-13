import { createOperator, DONE, normalizeError } from '../atoms';
import type { PipeInput } from '../atoms/pipe';
import { from } from '../factories';
import { __streamixBeginLifetime } from '../runtime/introspection-hooks';
import { createAsyncPushable } from '../utils';

/** Configuration for {@link correlate}. */
export interface CorrelateOptions<Q, A, K> {
  /** Extracts the correlation key from an outgoing request. */
  requestKey(request: Q): K;
  /** Extracts the correlation key from an incoming response. */
  responseKey(response: A): K;
  /**
   * How long, in milliseconds, an outstanding request may wait for its
   * response. Expiry fails the output with `Error('Correlation timed out')`.
   * Must be a nonnegative finite number; validated when the operator is
   * created.
   */
  timeout?: number;
}

/** A request paired with the response that shares its correlation key. */
export interface Correlated<Q, A> { request: Q; response: A }

/**
 * Joins outgoing requests with incoming responses using a correlation key.
 *
 * Use this for request/response protocols carried over separate streams — RPC
 * over a socket or message bus, for example — where responses can arrive out
 * of order. Each request is held until its matching response arrives, and the
 * output emits `{ request, response }` pairs.
 *
 * Responses that arrive before their request are retained by key (the latest
 * response per key wins) and matched when that request appears. A key may have
 * only one outstanding request at a time: emitting another request with the
 * same key before the first is matched fails the output.
 *
 * The output completes when the request stream ends and every pending request
 * has been answered. If the response stream ends while requests are still
 * pending, or a request exceeds the optional timeout, the output fails.
 *
 * Typical scenarios:
 *
 * - RPC over a shared socket, worker, or message bus where responses arrive
 *   out of order.
 * - Matching commands to acknowledgements by request id.
 * - Accepting responses that arrive before their request.
 *
 * @typeParam Q - The request value type.
 * @typeParam A - The response value type.
 * @typeParam K - The correlation key type.
 * @param responses - Stream, atom, iterable, or promise of incoming
 *   responses.
 * @param options - Key extractors and the optional request timeout.
 * @returns An operator that emits matched request/response pairs.
 *
 * @example
 * ```ts
 * // `outgoing` is the request stream; `incoming` is the response stream.
 * const pairs = pipe(outgoing, correlate(incoming, {
 *   requestKey: request => request.id,
 *   responseKey: response => response.id,
 *   timeout: 5_000,
 * }));
 * ```
 */
export function correlate<Q, A, K>(responses: PipeInput<A>, options: CorrelateOptions<Q, A, K>) {
  return createOperator<Q, Correlated<Q, A>>('correlate', function (this, source) {
    const responsesLifetime = __streamixBeginLifetime(this);
    responsesLifetime?.start();
    const output = createAsyncPushable<Correlated<Q, A>>();
    const responseIt = from(responses)[Symbol.asyncIterator]();
    const pending = new Map<K, { request: Q; timer?: ReturnType<typeof setTimeout> }>();
    const early = new Map<K, A>();
    let stopped = false, requestsDone = false;
    const complete = () => { if (!stopped && requestsDone && pending.size === 0) { stop(); output.dispose(); } };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const entry of pending.values()) if (entry.timer) clearTimeout(entry.timer);
      pending.clear();
      void Promise.resolve(source.return?.()).catch(() => {});
      void Promise.resolve(responseIt.return?.()).catch(() => {});
    };
    const fail = (error: unknown) => { if (!stopped) { stop(); output.fail(normalizeError(error)); } };
    if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout < 0))
      throw new RangeError('correlate timeout must be a nonnegative finite number');
    void (async () => {
      try {
        while (!stopped) {
          const result = await responseIt.next();
          if (stopped || result.done) break;
          const key = options.responseKey(result.value);
          const match = pending.get(key);
          if (!match) { early.set(key, result.value); continue; }
          pending.delete(key);
          if (match.timer) clearTimeout(match.timer);
          output.push({ request: match.request, response: result.value });
          responsesLifetime?.output();
          complete();
        }
        if (!stopped && pending.size) { responsesLifetime?.finish('error'); fail(new Error('Response source completed with outstanding requests')); }
        else responsesLifetime?.finish(stopped ? 'cancel' : 'complete');
      } catch (error) { responsesLifetime?.finish('error'); fail(error); }
    })();
    void (async () => {
      try {
        while (!stopped) {
          const item = await source.next();
          if (stopped || item.done) break;
          const key = options.requestKey(item.value);
          if (pending.has(key)) throw new Error('Duplicate outstanding correlation key');
          const entry: { request: Q; timer?: ReturnType<typeof setTimeout> } = { request: item.value };
          pending.set(key, entry);
          if (early.has(key)) {
            const response = early.get(key) as A;
            early.delete(key);
            pending.delete(key);
            output.push({ request: item.value, response });
            continue;
          }
          if (options.timeout !== undefined) entry.timer = setTimeout(() => fail(new Error('Correlation timed out')), options.timeout);
        }
        requestsDone = true;
        complete();
      } catch (error) { fail(error); }
    })();
    return {
      next: () => output.next(),
      async return() { stop(); output.dispose(); return DONE; },
      async throw(error: unknown) { fail(error); throw normalizeError(error); },
    };
  });
}
