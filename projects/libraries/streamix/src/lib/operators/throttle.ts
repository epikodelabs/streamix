import { createPushOperator, isPromiseLike, type MaybePromise } from '../abstractions';

/**
 * Creates a throttle operator that emits the first value immediately, then ignores subsequent
 * values for the specified duration. If new values arrive during the cooldown, the
 * last one is emitted after the cooldown expires (trailing emit).
 *
 * Values suppressed during the cooldown window are forwarded with `dropped: true` so
 * that backpressure is released without surfacing them as real emissions. Only the
 * trailing value (if any) is emitted normally after the cooldown.
 *
 * @template T The type of values emitted by the source and output.
 * @param duration The throttle duration in milliseconds.
 * @returns An Operator instance that applies throttling to the source stream.
 */
export const throttle = <T = any>(duration: MaybePromise<number>) =>
  createPushOperator<T>('throttle', (source, output) => {
    let lastEmit = 0;
    let pendingResult: IteratorResult<T> | undefined;
    let droppedDuringCooldown: T[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolvedDuration: number | undefined = undefined;

    const flushPending = () => {
      if (pendingResult !== undefined) {
        // Drop all values that were superseded during the cooldown.
        for (const v of droppedDuringCooldown) {
          output.drop(v);
        }
        droppedDuringCooldown = [];

        output.push(pendingResult.value!);
        pendingResult = undefined;
        lastEmit = Date.now();
      }
      timer = null;
    };

    void (async () => {
      try {
        resolvedDuration = isPromiseLike(duration) ? await duration : duration;

        while (true) {
          const result = await source.next();
          if (result.done) break;

          const now = Date.now();
          if (resolvedDuration === undefined) {
            pendingResult = result;
            continue;
          }

          if (now - lastEmit >= resolvedDuration) {
            // If a timer is running and a new value arrives after cooldown, flush pending first
            if (timer) {
              clearTimeout(timer);
              timer = null;
              flushPending();
            }
            output.push(result.value);
            lastEmit = now;
          } else {
            // Supersede any previous pending value — mark it as dropped.
            if (pendingResult !== undefined) {
              droppedDuringCooldown.push(pendingResult.value!);
            }
            pendingResult = result;
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
