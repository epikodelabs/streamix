import { atom, createAsyncIterator, type AtomBase, type Receiver } from "@epikodelabs/streamix";

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
 * @returns {Atom<number>} An atom emitting frame-to-frame time deltas.
 */
export function onAnimationFrame(): AtomBase<number> {
  const atom$ = atom<number>();

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

      atom$.next(delta);
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      startLoop();
    }
  };

  (atom$ as any).subscribe = (
    callback?: ((value: number) => void) | Receiver<number>
  ) => {
    const callbackFn = typeof callback === "function"
      ? callback
      : (value: number) => callback?.next?.(value);

    const subscription = (originalSubscribe as any).call(atom$, callbackFn);

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

        // Some specs expect teardown to run synchronously.
        const teardown = subscription.teardown;
        subscription.teardown = undefined;
        try {
          teardown?.();
        } catch {
        }
      }

      return baseUnsubscribe();
    };

    return subscription;
  };

  (atom$ as any)[Symbol.asyncIterator] = () =>
    createAsyncIterator({ register: (receiver: Receiver<any>) => atom$.subscribe(receiver as any) })();

  (atom$ as any).name = "onAnimationFrame";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<number>;
}
