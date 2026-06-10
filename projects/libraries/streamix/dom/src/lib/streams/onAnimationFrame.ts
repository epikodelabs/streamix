import { atom, createStream, iterate, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the time delta (in milliseconds) between
 * consecutive animation frames.
 *
 * This stream is driven by `requestAnimationFrame` when available, with a
 * timer-based fallback for non-browser environments.
 *
 * **Behavior:**
 * - A shared RAF loop starts on first subscription and stops when the signal
 *   is aborted (last subscriber unsubscribes).
 * - Emits the delta (ms) between consecutive frames; the first frame emits 0.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<number>} A stream emitting frame-to-frame time deltas.
 */
export function onAnimationFrame(): Stream<number> {
  return createStream<number>("onAnimationFrame", async function* (signal) {
    // SSR / non-browser guard
    if (typeof globalThis.performance === "undefined") return;

    const atom$ = atom<number>();

    const hasRaf =
      typeof (globalThis as any).requestAnimationFrame === "function";

    const raf: (cb: FrameRequestCallback) => number = hasRaf
      ? (globalThis as any).requestAnimationFrame.bind(globalThis)
      : ((cb: FrameRequestCallback) =>
          globalThis.setTimeout(
            () => cb(globalThis.performance.now()),
            16
          )) as unknown as (cb: FrameRequestCallback) => number;

    const cancelFrame: (id: any) => void =
      hasRaf &&
      typeof (globalThis as any).cancelAnimationFrame === "function"
        ? (globalThis as any).cancelAnimationFrame.bind(globalThis)
        : globalThis.clearTimeout.bind(globalThis);

    let rafId: number | null = null;
    let lastTime = 0;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (signal) {
        try {
          signal.removeEventListener("abort", cleanup);
        } catch {
          // ignore
        }
      }
      if (rafId !== null) {
        try {
          cancelFrame(rafId);
        } catch {
          // ignore
        }
        rafId = null;
      }
      atom$.dispose();
    };

    if (signal) {
      signal.addEventListener("abort", cleanup, { once: true });
    }

    const tick = (now: number) => {
      if (signal?.aborted) return;

      const delta = lastTime > 0 ? Math.max(0, now - lastTime) : 0;
      lastTime = now;

      atom$.set(delta);
      rafId = raf(tick);
    };

    rafId = raf(tick);

    try {
      yield* { [Symbol.asyncIterator]: () => iterate(atom$, signal) };
    } finally {
      cleanup();
    }
  });
}
