import { createPushOperator, normalizeError } from "../atoms";

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
export const throttle = <T = any>(duration: number) =>
  createPushOperator<T>('throttle', (source, output) => {
    let lastEmit = -Infinity; // Initialize to -Infinity to ensure the first value is always emitted as a leading value
    let pendingResult: IteratorResult<T> | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolvedDuration: number | undefined = undefined;
    // Track whether the operator has been torn down so that a flushPending()
    // callback queued before cleanup fires cannot write to an
    // already-completed/aborted output.
    let aborted = false;

    const flushPending = () => {
      // Guard against firing after cleanup.
      if (aborted) {
        timer = null;
        return;
      }

      if (pendingResult !== undefined) {
        output.push(pendingResult.value);
        pendingResult = undefined;
        // After a trailing emit, the cooldown should start from now.
        lastEmit = Date.now();
      }
      timer = null;
    };

    void (async () => {
      try {
        resolvedDuration = duration;

        while (true) {
          const result = await source.next();
          if (result.done) break;

          const now = Date.now();

          if (now - lastEmit >= resolvedDuration) {
            // A new value arrived after the cooldown. If a timer is still
            // running it means the scheduled trailing emit hasn't fired yet
            // (the event loop hadn't yielded). Flush it as a real trailing
            // emission first, then emit the new value as the next leading emit.
            if (timer) {
              clearTimeout(timer);
              timer = null;
              flushPending(); // emits pendingResult and advances lastEmit
            }
            output.push(result.value);
            lastEmit = now;
          } else {
            pendingResult = result;
            if (!timer) {
              const delay = resolvedDuration - (now - lastEmit);
              timer = setTimeout(flushPending, delay);
            }
          }
        }

        if (pendingResult !== undefined) flushPending();
      } catch (err) {
        // Normalise to Error, consistent with every other operator.
        output.fail(normalizeError(err));
      } finally {
        aborted = true;
        if (timer) { clearTimeout(timer); timer = null; }
        if (!output.disposed) output.dispose();
      }
    })();

    return () => {
      aborted = true;
      if (timer) { clearTimeout(timer); timer = null; }
    };
  });
