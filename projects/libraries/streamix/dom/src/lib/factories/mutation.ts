import { createSharedSource, type Atom } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits arrays of `MutationRecord` objects
 * whenever mutations are observed on a given DOM element.
 *
 * This stream is a wrapper around the `MutationObserver` API and is useful
 * for reacting to DOM structure or attribute changes.
 *
 * **Behavior:**
 * - Reads the target element and options once on first subscription.
 * - Emits mutation records whenever changes occur.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element to observe.
 * @param options Optional MutationObserver options.
 * @returns {Atom<MutationRecord[]>} An atom of mutation records.
 */
export function mutation(
  element: Element,
  options?: MutationObserverInit
): Atom<MutationRecord[]> {
  return createSharedSource<MutationRecord[]>((push) => {
    let cleaned = false;
    let observer: MutationObserver | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      observer?.disconnect();
      observer = null;
    };

    const emit = async (value: MutationRecord[]) => {
      if (cleaned) return;
      await push(value);
    };

    // SSR / unsupported guard
    if (typeof MutationObserver === "undefined") {
      return cleanup;
    }

    void (async () => {
      const resolvedElement = element ?? null;
      const resolvedOptions = options;

      if (cleaned || !resolvedElement) {
        return;
      }

      observer = new MutationObserver(async mutations => {
        await emit([...mutations]);
      });

      observer.observe(resolvedElement, resolvedOptions);
    })();

    return cleanup;
  }, { name: "mutation" });
}
