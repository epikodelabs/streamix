import { createOperator, DONE, normalizeError } from '../atoms';
import { __streamixBeginLifetime } from '../runtime/introspection-hooks';
import { createAsyncPushable } from '../utils';

/**
 * Hooks that {@link handoff} uses to build, validate, and release the
 * resources it swaps in.
 */
export interface HandoffOptions<T, R> {
  /**
   * Builds the resource for a source value — for example, starts loading an
   * image, opening a connection, or mounting a worker.
   *
   * Runs while the previous resource is still active. The signal aborts when
   * a newer source value makes this one stale; use it to cancel in-flight
   * work. Created resources are released through {@link dispose}, not here.
   */
  prepare(value: T, signal: AbortSignal): Promise<R> | R;
  /**
   * Resolves when the prepared resource is safe to use — for example, after
   * an image decodes, a connection opens, or a component mounts.
   *
   * The resource enters the output only after this settles successfully.
   * Rejecting disposes the resource and fails the output while this value is
   * still the latest. The resolved value is ignored.
   */
  ready(resource: R, signal: AbortSignal): Promise<unknown> | unknown;
  /**
   * Releases a resource after it is replaced, superseded, or failed, or when
   * the output completes. Each prepared resource is disposed at most once;
   * returned rejections are ignored.
   */
  dispose(resource: R): Promise<void> | void;
}

/**
 * Keeps one live resource active and swaps it for the next one only after the
 * replacement is ready.
 *
 * Think of it as double buffering for resources: while source value `b` is
 * being prepared, the resource built for `a` stays active and in use. When
 * `b` passes `ready`, it is emitted and the resource for `a` is disposed.
 * If a newer value arrives before a provisional resource is ready, that work
 * is aborted through its signal and the half-built resource is disposed
 * without ever being emitted — latest wins.
 *
 * Lifecycle of one source value:
 *
 * 1. `prepare(value, signal)` builds the replacement; the current resource
 *    stays active.
 * 2. `ready(resource, signal)` validates it.
 * 3. The resource is emitted downstream and becomes active.
 * 4. The resource it replaced is disposed.
 *
 * ```
 * source    a ───────── b ───────── c ────────►
 * prepare   ├─ a         ├─ b         ├─ c
 * ready     │    ✓ a     │    ✓ b     │    ✓ c
 * emit      │    a       │    b       │    c
 * dispose   │            │    a       │    b
 * ```
 *
 * A rejection from `prepare` or `ready` fails the output only while its value
 * is still the latest; stale failures are ignored. The output completes after
 * the source ends and the final replacement settles, disposing the active
 * resource at the end.
 *
 * Typical scenarios:
 *
 * - Swapping the displayed image or video without blanking the screen while
 *   the next one loads.
 * - Replacing a connection, worker, or route view only after the replacement
 *   is ready, keeping the old one live until then.
 * - Cancelling stale preparations when the user changes selection quickly.
 *
 * Use {@link switchMap} instead when each source value expands into a stream
 * of values rather than one disposable resource.
 *
 * @typeParam T - The type of values emitted by the source stream.
 * @typeParam R - The type of the prepared resource emitted downstream.
 * @param options - Preparation, readiness, and disposal hooks.
 * @returns An operator that emits the latest resource that passed `ready`.
 *
 * @example
 * ```ts
 * // Keep the current image on screen until its successor is decoded.
 * const image = pipe(selectedUrl, handoff({
 *   prepare: (url, signal) => loadImage(url, signal),
 *   ready: (image) => image.decode(),
 *   dispose: (image) => image.close(),
 * }));
 * ```
 */
export function handoff<T, R>(options: HandoffOptions<T, R>) {
  return createOperator<T, R>('handoff', function (this, source) {
    const operator = this;
    const output = createAsyncPushable<R>();
    let stopped = false, sourceDone = false, inFlight = 0, generation = 0, active: R | undefined;
    let hasActive = false;
    let controller: AbortController | undefined;
    const dispose = (value: R) => { void Promise.resolve().then(() => options.dispose(value)).catch(() => {}); };
    const stop = () => {
      if (stopped) return;
      stopped = true; generation++; controller?.abort();
      if (hasActive) dispose(active as R);
      hasActive = false;
      void Promise.resolve(source.return?.()).catch(() => {});
    };
    const fail = (error: unknown) => { if (!stopped) { stop(); output.fail(normalizeError(error)); } };
    const finish = () => {
      if (!stopped && sourceDone && inFlight === 0) {
        stopped = true;
        if (hasActive) dispose(active as R);
        hasActive = false;
        output.dispose();
      }
    };
    void (async () => {
      try {
        while (!stopped) {
          const item = await source.next();
          if (stopped || item.done) break;
          controller?.abort();
          const signal = (controller = new AbortController()).signal;
          const version = ++generation;
          inFlight++;
          const lifetime = __streamixBeginLifetime(operator);
          lifetime?.start();
          void (async () => {
            let resource: R;
            try { resource = await options.prepare(item.value, signal); }
            catch (error) { lifetime?.finish('error'); if (!signal.aborted && version === generation) fail(error); return; }
            if (signal.aborted || stopped || version !== generation) { lifetime?.finish('cancel'); dispose(resource); return; }
            try { await options.ready(resource, signal); }
            catch (error) { lifetime?.finish('error'); dispose(resource); if (!signal.aborted && version === generation) fail(error); return; }
            if (signal.aborted || stopped || version !== generation) { lifetime?.finish('cancel'); dispose(resource); return; }
            const old = active, hadOld = hasActive;
            active = resource; hasActive = true;
            output.push(resource);
            lifetime?.output();
            lifetime?.finish('complete');
            if (hadOld) dispose(old as R);
          })().finally(() => { inFlight--; finish(); });
        }
        sourceDone = true;
        finish();
      } catch (error) { fail(error); }
    })();
    return {
      next: () => output.next(),
      async return() { stop(); output.dispose(); return DONE; },
      async throw(error: unknown) { fail(error); throw normalizeError(error); },
    };
  });
}
