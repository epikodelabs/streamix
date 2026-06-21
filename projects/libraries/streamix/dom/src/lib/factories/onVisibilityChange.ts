import { createSharedSource, type AtomBase } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the document's visibility state
 * whenever it changes.
 *
 * This stream is useful for:
 * - pausing animations or polling when the page is hidden
 * - throttling background work
 * - detecting tab switching or minimization
 *
 * **Behavior:**
 * - Emits the current visibility state on start.
 * - Emits on every `visibilitychange` event.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Atom<DocumentVisibilityState>}
 */
export function onVisibilityChange(): AtomBase<DocumentVisibilityState> {
  return createSharedSource<DocumentVisibilityState>((push) => {
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      if (typeof document === "undefined") return;
      document.removeEventListener("visibilitychange", emit);
    };

    const getState = (): DocumentVisibilityState => {
      if (typeof document === "undefined") {
        return "visible";
      }

      const state = (document as any).visibilityState;
      if (state === "visible" || state === "hidden") {
        return state;
      }
      return "visible";
    };

    const emit = async () => {
      if (cleaned) return;
      await push(getState());
    };

    // SSR / unsupported guard
    if (typeof document === "undefined") {
      return cleanup;
    }

    document.addEventListener("visibilitychange", emit);

    void emit();

    return cleanup;
  }, { name: "onVisibilityChange" });
}
