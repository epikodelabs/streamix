import { createAsyncIterator, createSubject, type Receiver, type Stream } from "@epikodelabs/streamix";

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
  let usingTimeoutFallback = false;

  const startLoop = () => {
    if (!stopped) return;
    stopped = false;

    // SSR / non-browser guard
    if (typeof globalThis.performance === "undefined") return;

    const raf: (cb: FrameRequestCallback) => number =
      typeof (globalThis as any).requestAnimationFrame === "function"
        ? (globalThis as any).requestAnimationFrame.bind(globalThis)
        : ((cb: FrameRequestCallback) =>
            globalThis.setTimeout(
              () => cb(globalThis.performance.now()),
              16
            )) as unknown as (cb: FrameRequestCallback) => number;

    usingTimeoutFallback =
      typeof (globalThis as any).requestAnimationFrame !== "function";

    lastTime = globalThis.performance.now();

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
      if (
        !usingTimeoutFallback &&
        typeof (globalThis as any).cancelAnimationFrame === "function"
      ) {
        (globalThis as any).cancelAnimationFrame(rafId);
      } else {
        globalThis.clearTimeout(rafId);
      }
      rafId = null;
    }
  };

  /* ------------------------------------------------------------------------
   * Ref-counted subscription handling
   * ---------------------------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      startLoop();
    }
  };

  subject.subscribe = (
    callback?: ((value: number) => void) | Receiver<number>
  ) => {
    const subscription = originalSubscribe.call(subject, callback);

    scheduleStart();

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
    createAsyncIterator({ register: (receiver: Receiver<number>) => subject.subscribe(receiver) })();

  subject.name = "onAnimationFrame";
  return subject;
}


