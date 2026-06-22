import { createSharedSource, type Atom } from "@epikodelabs/streamix";

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
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Atom<ViewportState>}
 */
export function viewportChange(): Atom<ViewportState> {
  return createSharedSource<ViewportState>((push) => {
    let cleaned = false;
    let target: VisualViewport | Window | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      if (!target) return;

      target.removeEventListener("resize", emit);
      target.removeEventListener("scroll", emit);

      target = null;
    };

    const snapshot = (): ViewportState => {
      if (typeof window === "undefined") {
        return {
          width: 0,
          height: 0,
          scale: 1,
          offsetLeft: 0,
          offsetTop: 0
        };
      }

      if (window.visualViewport) {
        const vp = window.visualViewport;
        return {
          width: vp.width,
          height: vp.height,
          scale: vp.scale,
          offsetLeft: vp.offsetLeft,
          offsetTop: vp.offsetTop
        };
      }

      return {
        width: window.innerWidth,
        height: window.innerHeight,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0
      };
    };

    const emit = async () => {
      if (cleaned) return;
      await push(snapshot());
    };

    // SSR guard
    if (typeof window === "undefined") {
      return cleanup;
    }

    target = window.visualViewport ?? window;

    target.addEventListener("resize", emit);
    target.addEventListener("scroll", emit);

    void emit();

    return cleanup;
  }, { name: "viewportChange" });
}
