import { asyncAtom, createStream, iterate, type Stream } from "@epikodelabs/streamix";

/**
 * Represents a snapshot of the visual viewport.
 */
export type ViewportState = {
  width: number;
  height: number;
  scale: number;
  offsetLeft: number;
  offsetTop: number;
};

/**
 * Creates a reactive stream that emits changes to the visual viewport.
 *
 * Uses `visualViewport` when available, falling back to `window`.
 *
 * **Behavior:**
 * - Emits initial viewport metrics on start.
 * - Emits on resize, scroll, and zoom.
 * - Stops listening when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<ViewportState>}
 */
export function onViewportChange(): Stream<ViewportState> {
  return createStream<ViewportState>("onViewportChange", async function* (signal) {
    // SSR guard
    if (typeof window === "undefined") return;

    const atom = asyncAtom<ViewportState>();

    const snapshot = (): ViewportState => {
      if (window.visualViewport) {
        const vp = window.visualViewport;
        return {
          width: vp.width,
          height: vp.height,
          scale: vp.scale,
          offsetLeft: vp.offsetLeft,
          offsetTop: vp.offsetTop,
        };
      }
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
      };
    };

    const emit = () => {
      if (signal?.aborted) {
        return;
      }
      atom.set(snapshot());
    };

    const target: VisualViewport | Window =
      window.visualViewport ?? window;

    target.addEventListener("resize", emit);
    target.addEventListener("scroll", emit);

    // Emit initial snapshot
    emit();

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
      try {
        target.removeEventListener("resize", emit);
      } catch {
        // ignore
      }
      try {
        target.removeEventListener("scroll", emit);
      } catch {
        // ignore
      }
      atom.dispose();
    };

    if (signal) {
      signal.addEventListener("abort", cleanup, { once: true });
    }

    try {
      yield* { [Symbol.asyncIterator]: () => iterate(atom, signal) };
    } finally {
      cleanup();
    }
  });
}
