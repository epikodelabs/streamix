import { atom, createStream, isPromiseLike, iterate, type MaybePromise, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits arrays of `MutationRecord` objects
 * whenever mutations are observed on a given DOM element.
 *
 * **Behavior:**
 * - Resolves the target element and options once on first subscription.
 * - Emits mutation records whenever changes occur.
 * - Stops observing when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @param options Optional MutationObserver options (or promise).
 * @returns {Stream<MutationRecord[]>} A stream of mutation records.
 */
export function onMutation(
  element: MaybePromise<Element>,
  options?: MaybePromise<MutationObserverInit>
): Stream<MutationRecord[]> {
  return createStream<MutationRecord[]>("onMutation", async function* (signal) {
    // SSR / unsupported guard
    if (typeof MutationObserver === "undefined") return;

    const el = isPromiseLike(element) ? await element : element;
    const resolvedOptions = isPromiseLike(options) ? await options : options;

    if (signal?.aborted || !el) return;

    const atom$ = atom<MutationRecord[]>();

    const observer = new MutationObserver((mutations) => {
      if (signal?.aborted) {
        return;
      }
      atom$.set([...mutations]);
    });

    observer.observe(el, resolvedOptions);

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
        observer.disconnect();
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
  });
}
