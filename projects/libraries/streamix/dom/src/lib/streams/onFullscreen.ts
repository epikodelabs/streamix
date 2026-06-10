import { atom, createStream, iterate, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits fullscreen state changes.
 *
 * Emits `true` when entering fullscreen and `false` when exiting.
 *
 * **Behavior:**
 * - Emits the initial fullscreen state on start.
 * - Emits on every fullscreen change.
 * - Supports vendor-prefixed implementations.
 * - Stops listening when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<boolean>}
 */
export function onFullscreen(): Stream<boolean> {
  return createStream<boolean>("onFullscreen", async function* (signal) {
    // SSR guard
    if (typeof document === "undefined") return;

    const atom$ = atom<boolean>();

    const isFullscreen = (): boolean =>
      !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );

    const emit = () => {
      if (signal?.aborted) {
        return;
      }
      atom$.set(isFullscreen());
    };

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
        document.removeEventListener("fullscreenchange", emit);
      } catch {
        // ignore
      }
      try {
        document.removeEventListener("webkitfullscreenchange", emit as any);
      } catch {
        // ignore
      }
      try {
        document.removeEventListener("mozfullscreenchange", emit as any);
      } catch {
        // ignore
      }
      try {
        document.removeEventListener("MSFullscreenChange", emit as any);
      } catch {
        // ignore
      }
      atom$.dispose();
    };

    if (signal) {
      signal.addEventListener("abort", cleanup, { once: true });
    }

    document.addEventListener("fullscreenchange", emit);
    document.addEventListener("webkitfullscreenchange", emit as any);
    document.addEventListener("mozfullscreenchange", emit as any);
    document.addEventListener("MSFullscreenChange", emit as any);

    // Emit initial state
    emit();

    try {
      yield* { [Symbol.asyncIterator]: () => iterate(atom$, signal) };
    } finally {
      cleanup();
    }
  });
}
