import { createSharedSource, type AtomBase } from "@epikodelabs/streamix";

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
  return createSharedSource<number>((push) => {
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (rafId !== null) {
        cancelFrame?.(rafId);
        rafId = null;
      }
      cancelFrame = null;
    };

    // SSR / non-browser guard
    if (typeof globalThis.performance === "undefined") {
      return cleanup;
    }

    let rafId: number | null = null;
    let lastTime = 0;
    let cancelFrame: ((id: any) => void) | null = null;

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

    const emit = async (value: number) => {
      if (cleaned) return;
      await push(value);
    };

    const tick = async (now: number) => {
      if (cleaned) return;

      // Some RAF polyfills can provide non-monotonic timestamps; clamp to 0.
      // Also treat the first tick as a 0-delta frame.
      let delta = 0;
      if (lastTime > 0 && now >= lastTime) {
        delta = now - lastTime;
      }
      if (now >= lastTime) {
        lastTime = now;
      }

      await emit(delta);
      if (cleaned) return;
      rafId = raf(tick);
    };

    lastTime = 0;
    rafId = raf(tick);

    return cleanup;
  }, { name: "onAnimationFrame" });
}
