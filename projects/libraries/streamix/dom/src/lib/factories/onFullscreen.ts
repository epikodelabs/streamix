import { createSharedSource, type AtomBase } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits fullscreen state changes.
 *
 * Emits `true` when entering fullscreen and `false` when exiting.
 *
 * **Behavior:**
 * - Emits the initial fullscreen state on start.
 * - Emits on every fullscreen change.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Supports vendor-prefixed implementations.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Atom<boolean>}
 */
export function onFullscreen(): AtomBase<boolean> {
  return createSharedSource<boolean>((push) => {
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      if (typeof document === "undefined") return;

      document.removeEventListener("fullscreenchange", emit);
      document.removeEventListener("webkitfullscreenchange", emit as any);
      document.removeEventListener("mozfullscreenchange", emit as any);
      document.removeEventListener("MSFullscreenChange", emit as any);
    };

    /**
     * Checks whether the document is currently in fullscreen mode.
     */
    const isFullscreen = (): boolean => {
      if (typeof document === "undefined") return false;

      return !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
    };

    const emit = async () => {
      if (cleaned) return;
      await push(isFullscreen());
    };

    // SSR guard
    if (typeof document === "undefined") {
      return cleanup;
    }

    document.addEventListener("fullscreenchange", emit);
    document.addEventListener("webkitfullscreenchange", emit as any);
    document.addEventListener("mozfullscreenchange", emit as any);
    document.addEventListener("MSFullscreenChange", emit as any);

    // Emit initial value immediately
    void emit();

    return cleanup;
  }, { name: "onFullscreen" });
}
