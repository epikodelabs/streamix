import type { Readable } from '../atoms/atom';
import type { MaybePromise } from '../atoms/operator';
import { toAsyncIterable, type PipeInput } from '../atoms/pipe';
import { raceNext } from '../utils/coordinator';
import { createPushSource } from './fromPush';

export interface UsingOptions<R, T> {
  acquire(signal: AbortSignal): MaybePromise<R>;
  stream(resource: R, signal: AbortSignal): MaybePromise<PipeInput<T>>;
  dispose(resource: R): MaybePromise<void>;
}

/**
 * Lazily owns one resource per active group of subscribers and one iterator.
 * After cancellation by the last consumer, cleanup finishes before a new
 * session starts. Completion and failure are terminal.
 * The inner iterator closes before the owning resource is disposed. If both
 * the stream and cleanup fail, the stream error is the cause of the reported
 * AggregateError. Cleanup failures during cancellation reject the last
 * unsubscribe or iterator return.
 *
 * @example
 * ```ts
 * const player = using({
 *   acquire: signal => openMediaSession(signal),
 *   stream: session => pipe(selectedVideo, handoff({
 *     awaitSupersededOnCompletion: true,
 *     prepare: (url, signal) => session.createPlayer(url, signal),
 *     ready: (player, signal) => player.waitUntilPlayable(signal),
 *     dispose: player => player.close(),
 *   })),
 *   dispose: session => session.close(),
 * });
 * const unsubscribe = player.subscribe(displayPlayer);
 * await unsubscribe();
 * ```
 */
export function using<R, T>(options: UsingOptions<R, T>): Readable<T> {
  return createPushSource<T>((sink, signal) => {
    // Adopt the teardown before running acquisition code that can reenter
    // subscription or disposal.
    const execution = Promise.resolve().then(async () => {
      if (signal.aborted) return;
      let resource: { value: R } | undefined;
      let child: AsyncIterator<T> | undefined;
      let failure: { reason: unknown } | undefined;
      const cleanupErrors: unknown[] = [];
      try {
        resource = { value: await options.acquire(signal) };
        if (!signal.aborted) {
          const stream = await options.stream(resource.value, signal);
          child = toAsyncIterable(stream)[Symbol.asyncIterator]();
          while (!signal.aborted) {
            const item = await raceNext(child, signal);
            if (item.done || signal.aborted) break;
            await sink.next(item.value);
          }
        }
      } catch (error) {
        if (!signal.aborted) failure = { reason: error };
      }
      try { await child?.return?.(); }
      catch (error) { cleanupErrors.push(error); }
      if (resource) {
        try { await options.dispose(resource.value); }
        catch (error) { cleanupErrors.push(error); }
      }

      if (signal.aborted) {
        if (cleanupErrors.length === 1) throw cleanupErrors[0];
        if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, 'Resource cleanup failed');
      } else if (failure && cleanupErrors.length) {
        sink.error(new AggregateError([failure.reason, ...cleanupErrors], 'Stream and resource cleanup failed', {
          cause: failure.reason,
        }));
      } else if (failure) {
        sink.error(failure.reason);
      } else if (cleanupErrors.length) {
        sink.error(cleanupErrors.length === 1 ? cleanupErrors[0] : new AggregateError(cleanupErrors, 'Resource cleanup failed'));
      } else {
        sink.complete();
      }
    });
    return () => execution;
  }, {}, true);
}
