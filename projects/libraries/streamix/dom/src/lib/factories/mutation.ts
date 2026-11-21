import { fromPush, type Readable } from "@epikodelabs/streamix";

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
 * @param options Optional MutationObserver options. When omitted, a
 * whole-subtree default (`childList`, `attributes`, `characterData`,
 * `subtree`) is observed. An options object that enables no observation
 * category is rejected through the source error channel: `observe()` would
 * otherwise throw outside the error contract.
 * @returns {Readable<MutationRecord[]>} An atom of mutation records.
 */
const DEFAULT_MUTATION_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  characterData: true,
};

export function mutation(
  element: Element,
  options?: MutationObserverInit
): Readable<MutationRecord[]> {
  return fromPush<MutationRecord[]>((sink) => {
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
      await sink.next(value);
    };

    // SSR / unsupported guard
    if (typeof MutationObserver === "undefined") {
      return cleanup;
    }

    void (async () => {
      const resolvedElement = element ?? null;
      // `observe()` requires at least one observation category and rejects an
      // options object with none of them. Supply the whole-subtree default
      // when options are omitted, and surface explicitly invalid options
      // through the error channel instead of an unhandled rejection.
      const resolvedOptions = options ?? DEFAULT_MUTATION_OPTIONS;

      if (
        !resolvedOptions.childList &&
        !resolvedOptions.attributes &&
        !resolvedOptions.characterData
      ) {
        sink.error(new TypeError(
          'mutation options must enable at least one of childList, attributes, or characterData.',
        ));
        return;
      }

      if (cleaned || !resolvedElement) {
        return;
      }

      observer = new MutationObserver(async mutations => {
        await emit([...mutations]);
      });

      try {
        observer.observe(resolvedElement, resolvedOptions);
      } catch (error) {
        sink.error(error);
        return;
      }
    })();

    return cleanup;
  }, { name: "mutation" });
}
