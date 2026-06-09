import { asyncAtom, createStream, isPromiseLike, iterate, type MaybePromise, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits `true` when a given element enters
 * the viewport and `false` when it leaves.
 *
 * **Behavior:**
 * - Resolves the element and options once on first subscription.
 * - Emits the current intersection state whenever it changes.
 * - Deduplicates consecutive identical values.
 * - Stops observing when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @param options Optional IntersectionObserver options (or promise).
 * @returns {Stream<boolean>} A stream emitting intersection state.
 */
export function onIntersection(
  element: MaybePromise<Element>,
  options?: MaybePromise<IntersectionObserverInit>
): Stream<boolean> {
  return createStream<boolean>("onIntersection", async function* (signal) {
    if (
      typeof IntersectionObserver === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }

    const el = (isPromiseLike(element) ? await element : element) ?? null;
    const resolvedOptions = isPromiseLike(options) ? await options : options;

    if (signal?.aborted || !el) return;

    const atom = asyncAtom<boolean>();

    // Deduplicate — IntersectionObserver can fire with the same value
    let last: boolean | undefined;
    const emit = (v: boolean) => {
      if (signal?.aborted || v === last) return;
      last = v;
      atom.set(v);
    };

    const computeInitial = (): boolean => {
      if (typeof window === "undefined") return false;
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    };

    let hasObserverEmitted = false;

    const io = new IntersectionObserver((entries) => {
      hasObserverEmitted = true;
      emit(entries[0]?.isIntersecting ?? false);
    }, resolvedOptions);

    io.observe(el);

    // Emit a best-effort initial value before the first IO callback fires
    if (!hasObserverEmitted) {
      emit(computeInitial());
    }

    // Watch for the element being removed from the DOM
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        if (!document.body.contains(el)) {
          atom.dispose();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    const cleanup = () => {
      try {
        io.disconnect();
      } catch {
        // ignore
      }
      try {
        mo?.disconnect();
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
