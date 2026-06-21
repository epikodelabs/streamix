import { createSharedSource, type AtomBase } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the current screen orientation,
 * either `"portrait"` or `"landscape"`, whenever it changes.
 *
 * **Behavior:**
 * - Emits the initial orientation on start.
 * - Emits whenever the orientation changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Atom<"portrait" | "landscape">}
 */
export function onOrientation(): AtomBase<"portrait" | "landscape"> {
  return createSharedSource<"portrait" | "landscape">((push) => {
    let cleaned = false;
    let orientation: ScreenOrientation | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      orientation?.removeEventListener("change", emit);
      orientation = null;
    };

    const getOrientation = (): "portrait" | "landscape" => {
      if (
        typeof window === "undefined" ||
        !window.screen ||
        !window.screen.orientation
      ) {
        return "portrait";
      }

      const angle = window.screen.orientation.angle;
      return angle === 0 || angle === 180 ? "portrait" : "landscape";
    };

    const emit = () => {
      if (cleaned) return;
      push(getOrientation());
    };

    if (typeof window === "undefined" || !window.screen) {
      return cleanup;
    }

    // If the Orientation API is unavailable, still emit a sane default once.
    if (!window.screen.orientation) {
      emit();
      return cleanup;
    }

    orientation = window.screen.orientation;
    orientation.addEventListener("change", emit);

    emit();

    return cleanup;
  }, { name: "onOrientation" });
}
