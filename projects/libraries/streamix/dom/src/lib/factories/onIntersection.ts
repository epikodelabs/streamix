import {
  createSharedSource,
  isPromiseLike,
  type AtomBase,
  type MaybePromise,
} from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits `true` when a given element enters
 * the viewport and `false` when it leaves.
 *
 * This stream is a wrapper around the `IntersectionObserver` API and is useful
 * for lazy loading, visibility tracking, and viewport-aware effects.
 *
 * **Behavior:**
 * - Resolves the element and options once on first subscription.
 * - Emits the current intersection state whenever it changes.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @param options Optional IntersectionObserver options (or promise).
 * @returns {Atom<boolean>} An atom emitting intersection state.
 */
export function onIntersection(
  element: MaybePromise<Element>,
  options?: MaybePromise<IntersectionObserverInit>
): AtomBase<boolean> {
  return createSharedSource<boolean>((push) => {
    let cleaned = false;
    let io: IntersectionObserver | null = null;
    let mo: MutationObserver | null = null;
    let lastValue: boolean | undefined;
    let hasEmitted = false;

    const emit = async (value: boolean) => {
      if (cleaned || value === lastValue) return;
      lastValue = value;
      hasEmitted = true;
      await push(value);
    };

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      try {
        io?.disconnect();
      } catch {}
      try {
        mo?.disconnect();
      } catch {}

      io = null;
      mo = null;
      lastValue = undefined;
      hasEmitted = false;
    };

    if (
      typeof IntersectionObserver === "undefined" ||
      typeof document === "undefined"
    ) {
      return cleanup;
    }

    void (async () => {
      const el = (isPromiseLike(element) ? await element : element) ?? null;
      const resolvedOptions = isPromiseLike(options) ? await options : options;

      if (cleaned || !el) {
        return;
      }

      const computeInitial = (target: Element): boolean => {
        if (typeof window === "undefined") return false;
        const rect = target.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      };

      io = new IntersectionObserver(async (entries) => {
        await emit(entries[0]?.isIntersecting ?? false);
      }, resolvedOptions);
      io.observe(el);

      if (!hasEmitted) {
        void emit(computeInitial(el));
      }

      if (typeof MutationObserver !== "undefined") {
        mo = new MutationObserver(() => {
          if (!document.body.contains(el)) {
            cleanup();
          }
        });
        mo.observe(document.body, { childList: true, subtree: true });
      }
    })();

    return cleanup;
  }, { name: "onIntersection" });
}
