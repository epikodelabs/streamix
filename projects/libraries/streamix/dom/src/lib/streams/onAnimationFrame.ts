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
  let cancelFrame: ((id: any) => void) | null = null;

  const startLoop = () => {
    if (!stopped) return;
    stopped = false;

    // SSR / non-browser guard
    if (typeof globalThis.performance === "undefined") return;

    const hasRaf = typeof (globalThis as any).requestAnimationFrame === "function";
    const raf: (cb: FrameRequestCallback) => number =
      typeof (globalThis as any).requestAnimationFrame === "function"
        ? (globalThis as any).requestAnimationFrame.bind(globalThis)
        : ((cb: FrameRequestCallback) =>
            globalThis.setTimeout(
              () => cb(globalThis.performance.now()),
              16
            )) as unknown as (cb: FrameRequestCallback) => number;

    // Pick the corresponding cancellation function.
    // Prefer `cancelAnimationFrame` when RAF is used, but fall back to `clearTimeout`
    // for environments where RAF is timer-based or cancelAnimationFrame is missing.
    if (hasRaf && typeof (globalThis as any).cancelAnimationFrame === "function") {
      cancelFrame = (globalThis as any).cancelAnimationFrame.bind(globalThis);
    } else {
      cancelFrame = globalThis.clearTimeout.bind(globalThis);
    }

    const tick = (now: number) => {
      if (stopped) return;

      // Some RAF polyfills can provide non-monotonic timestamps; clamp to 0.
      // Also treat the first tick as a 0-delta frame.
      let delta = 0;
      if (lastTime > 0 && now >= lastTime) {
        delta = now - lastTime;
      }
      if (now >= lastTime) {
        lastTime = now;
      }

      subject.next(delta);
      rafId = raf(tick);
    };

    lastTime = 0;
    rafId = raf(tick);
  };

  const stopLoop = () => {
    if (stopped) return;
    stopped = true;

    if (rafId !== null) {
      cancelFrame?.(rafId);
      rafId = null;
    }
    cancelFrame = null;
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

    const baseUnsubscribe = subscription.unsubscribe.bind(subscription);
    let cleaned = false;

    subscription.unsubscribe = () => {
      if (!cleaned) {
        cleaned = true;

        subscriberCount = Math.max(0, subscriberCount - 1);
        if (subscriberCount === 0) {
          stopLoop();
        }

        // Some specs expect onUnsubscribe to run synchronously.
        const onUnsubscribe = subscription.onUnsubscribe;
        subscription.onUnsubscribe = undefined;
        try {
          onUnsubscribe?.();
        } catch {
        }
      }

      return baseUnsubscribe();
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


