import { createPushOperator, getIteratorMeta, isPromiseLike, type MaybePromise } from '../abstractions';

/**
 * Creates a throttle operator that emits the first value immediately, then ignores subsequent
 * values for the specified duration. If new values arrive during the cooldown, the
 * last one is emitted after the cooldown expires (trailing emit).
 *
 * @template T The type of values emitted by the source and output.
 * @param duration The throttle duration in milliseconds.
 * @returns An Operator instance that applies throttling to the source stream.
 */
export const throttle = <T = any>(duration: MaybePromise<number>) =>
  createPushOperator<T>('throttle', (source, output) => {
    let lastEmit = 0;
    let pendingResult: (IteratorResult<T> & { meta?: ReturnType<typeof getIteratorMeta> }) | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolvedDuration: number | undefined = undefined;

    const flushPending = () => {
      if (pendingResult !== undefined) {
        output.push(pendingResult.value!, pendingResult.meta);
        pendingResult = undefined;
      }
      timer = null;
      lastEmit = Date.now();
    };

    void (async () => {
      try {
        resolvedDuration = isPromiseLike(duration) ? await duration : duration;

        while (true) {
          const result = await source.next();
          if (result.done) break;

          const now = Date.now();
          const meta = getIteratorMeta(source);

          if (resolvedDuration === undefined) {
            pendingResult = result;
            if (meta) (pendingResult as any).meta = meta;
            continue;
          }

          if (now - lastEmit >= resolvedDuration) {
            output.push(result.value, meta);
            lastEmit = now;
          } else {
            pendingResult = result;
            if (meta) (pendingResult as any).meta = meta;
            if (!timer) {
              const delay = resolvedDuration - (now - lastEmit);
              timer = setTimeout(flushPending, delay);
            }
          }
        }

        if (pendingResult !== undefined) flushPending();
      } catch (err) {
        output.error(err);
      } finally {
        if (timer) { clearTimeout(timer); timer = null; }
        if (!output.completed()) output.complete();
      }
    })();

    return () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
  });
