import { atom, createStream, iterate, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the current screen orientation —
 * either `"portrait"` or `"landscape"` — whenever it changes.
 *
 * **Behavior:**
 * - Emits the initial orientation on start.
 * - Emits whenever the orientation changes.
 * - Stops listening when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<"portrait" | "landscape">}
 */
export function onOrientation(): Stream<"portrait" | "landscape"> {
  return createStream<"portrait" | "landscape">(
    "onOrientation",
    async function* (signal) {
      // SSR guard
      if (typeof window === "undefined" || !window.screen) return;

      const atom$ = atom<"portrait" | "landscape">();

      const getOrientation = (): "portrait" | "landscape" => {
        if (!window.screen.orientation) return "portrait";
        const angle = window.screen.orientation.angle;
        return angle === 0 || angle === 180 ? "portrait" : "landscape";
      };

      const emit = () => {
        if (signal?.aborted) {
          return;
        }
        atom$.set(getOrientation());
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
        if (window.screen?.orientation) {
          try {
            window.screen.orientation.removeEventListener("change", emit);
          } catch {
            // ignore
          }
        }
        atom$.dispose();
      };

      if (signal) {
        signal.addEventListener("abort", cleanup, { once: true });
      }

      if (window.screen.orientation) {
        window.screen.orientation.addEventListener("change", emit);
      }

      // Emit initial orientation
      emit();

      try {
        yield* { [Symbol.asyncIterator]: () => iterate(atom$, signal) };
      } finally {
        cleanup();
      }
    }
  );
}
