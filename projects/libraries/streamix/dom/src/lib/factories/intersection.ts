import {
  createSharedSource,
  type Atom,
} from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits `true` when a given element enters
 * the viewport and `false` when it leaves.
 *
 * This stream is a wrapper around the `IntersectionObserver` API and is useful
 * for lazy loading, visibility tracking, and viewport-aware effects.
 *
 * **Behavior:**
 * - Reads the element and options once on first subscription.
 * - Emits the current intersection state whenever it changes.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element to observe.
 * @param options Optional IntersectionObserver options.
 * @returns {Atom<boolean>} An atom emitting intersection state.
 */
export function intersection(
  element: Element,
  options?: IntersectionObserverInit
): Atom<boolean> {
  return createSharedSource<boolean>((push) => {
    let cleaned = false;
    let io: IntersectionObserver | null = null;
    let mo: MutationObserver | null = null;
    let lastValue: boolean | undefined;
    let hasEmitted = false;
    let paused = false;

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
      const el = element ?? null;
      const resolvedOptions = options;

      if (cleaned || !el) {
        return;
      }

      const computeInitial = (target: Element): boolean => {
        if (typeof window === "undefined") return false;
        const rect = target.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      };

      const observe = () => {
        io?.disconnect();
        io = new IntersectionObserver(async (entries) => {
          await emit(entries[0]?.isIntersecting ?? false);
        }, resolvedOptions);
        io.observe(el);
      };

      observe();

      if (!hasEmitted) {
        void emit(computeInitial(el));
      }

      if (typeof MutationObserver !== "undefined") {
        mo = new MutationObserver(() => {
          if (cleaned) return;

          if (!document.body.contains(el)) {
            // The element left the DOM (a framework may detach and re-attach
            // it, e.g. list recycling). Pause observation instead of tearing
            // the shared source down while subscribers are still attached.
            paused = true;
            try {
              io?.disconnect();
            } catch {}
            return;
          }

          if (paused) {
            paused = false;
            observe();
          }
        });
        mo.observe(document.body, { childList: true, subtree: true });
      }
    })();

    return cleanup;
  }, { name: "intersection" });
}
