import { atom, createStream, iterate, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the document's visibility state
 * whenever it changes.
 *
 * Useful for pausing animations, throttling background work, or detecting
 * tab switching and minimization.
 *
 * **Behavior:**
 * - Emits the current visibility state on start.
 * - Emits on every `visibilitychange` event.
 * - Stops listening when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<DocumentVisibilityState>}
 */
export function onVisibilityChange(): Stream<DocumentVisibilityState> {
  return createStream<DocumentVisibilityState>(
    "onVisibilityChange",
    async function* (signal) {
      // SSR / unsupported guard
      if (typeof document === "undefined") return;

      const atom$ = atom<DocumentVisibilityState>();

      const getState = (): DocumentVisibilityState => {
        const s = (document as any).visibilityState;
        return s === "hidden" ? "hidden" : "visible";
      };

      const emit = () => {
        if (signal?.aborted) {
          return;
        }
        atom$.set(getState());
      };

      document.addEventListener("visibilitychange", emit);

      // Emit initial state
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
          document.removeEventListener("visibilitychange", emit);
        } catch {
          // ignore
        }
        atom$.dispose();
      };

      if (signal) {
        signal.addEventListener("abort", cleanup, { once: true });
      }

      try {
        yield* { [Symbol.asyncIterator]: () => iterate(atom$, signal) };
      } finally {
        cleanup();
      }
    }
  );
}
