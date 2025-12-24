import { createAsyncGenerator, createSubject, type Receiver, type Stream } from "@epikode/streamix";

/**
 * Creates a reactive stream that emits the time delta (in milliseconds) between
 * consecutive animation frames.
 *
 * This stream is driven by `requestAnimationFrame` when available, with a
 * timer-based fallback for non-browser environments.
 *
 * **Behavior:**
 * - A shared RAF loop starts when the first subscriber subscribes.
 * - Emits the delta between consecutive frames.
 * - Stops the RAF loop when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<number>} A stream emitting frame-to-frame time deltas.
 */
export function onAnimationFrame(): Stream<number> {
  const subject = createSubject<number>();

  let subscriberCount = 0;
  let stopped = true;

  let rafId: number | null = null;
  let lastTime = 0;

  const startLoop = () => {
    if (!stopped) return;
    stopped = false;

    // SSR / non-browser guard
    if (typeof performance === "undefined") return;

    const raf: typeof requestAnimationFrame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : ((cb: FrameRequestCallback) =>
            setTimeout(
              () => cb(performance.now()),
              16
            )) as unknown as typeof requestAnimationFrame;

    lastTime = performance.now();

    const tick = (now: number) => {
      if (stopped) return;

      const delta = now - lastTime;
      lastTime = now;

      subject.next(delta);
      rafId = raf(tick);
    };

    rafId = raf(tick);
  };

  const stopLoop = () => {
    if (stopped) return;
    stopped = true;

    if (rafId !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      } else {
        clearTimeout(rafId);
      }
      rafId = null;
    }
  };

  /* ------------------------------------------------------------------------
   * Ref-counted subscription handling
   * ---------------------------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  subject.subscribe = (
    callback?: ((value: number) => void) | Receiver<number>
  ) => {
    const subscription = originalSubscribe.call(subject, callback);

    if (++subscriberCount === 1) {
      startLoop();
    }

    const originalOnUnsubscribe = subscription.onUnsubscribe;
    subscription.onUnsubscribe = () => {
      if (--subscriberCount === 0) {
        stopLoop();
      }
      originalOnUnsubscribe?.call(subscription);
    };

    return subscription;
  };

  /* ------------------------------------------------------------------------
   * Async iteration support
   * ---------------------------------------------------------------------- */

  subject[Symbol.asyncIterator] = () =>
    createAsyncGenerator(receiver => subject.subscribe(receiver));

  subject.name = "onAnimationFrame";
  return subject;
}

