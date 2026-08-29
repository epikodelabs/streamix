import { createSharedSource, type Atom } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the dimensions of a given DOM element
 * whenever it is resized.
 *
 * This stream is a wrapper around the `ResizeObserver` API.
 *
 * **Behavior:**
 * - Reads the element once on first subscription.
 * - Emits the current width and height whenever the element is resized.
 * - Emits the initial size on start.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element to observe.
 * @returns {Atom<{ width: number; height: number }>}
 */
export function resize(
  element: HTMLElement
): Atom<{ width: number; height: number }> {
  return createSharedSource<{ width: number; height: number }>((push) => {
    let cleaned = false;
    let resolvedElement: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      observer?.disconnect();
      observer = null;
      resolvedElement = null;
    };

    const emit = async (entry?: ResizeObserverEntry) => {
      if (cleaned || !resolvedElement) return;

      // Prefer contentBoxSize over deprecated contentRect for modern browsers.
      // contentBoxSize is a FrozenArray<ResizeObserverSize>, use the first entry.
      let width: number;
      let height: number;

      if (entry?.contentBoxSize?.length) {
        const boxSize = entry.contentBoxSize[0];
        width = Math.round(boxSize.inlineSize);
        height = Math.round(boxSize.blockSize);
      } else if (entry?.contentRect) {
        // Fallback to contentRect for older browsers
        width = Math.round(entry.contentRect.width);
        height = Math.round(entry.contentRect.height);
      } else {
        // Derive the content box for the initial (observer-less) emit so it
        // matches what the observer's own first callback will report: the
        // border-box rect minus padding and border widths.
        const rect = resolvedElement.getBoundingClientRect();
        const style = typeof getComputedStyle === "function"
          ? getComputedStyle(resolvedElement)
          : null;
        const edge = (name: string): number =>
          style ? parseFloat(style.getPropertyValue(name)) || 0 : 0;

        width = Math.round(
          rect.width
          - edge("padding-left") - edge("padding-right")
          - edge("border-left-width") - edge("border-right-width")
        );
        height = Math.round(
          rect.height
          - edge("padding-top") - edge("padding-bottom")
          - edge("border-top-width") - edge("border-bottom-width")
        );
      }

      await push({ width, height });
    };

    // SSR / unsupported
    if (typeof ResizeObserver === "undefined") {
      return cleanup;
    }

    void (async () => {
      const el = element ?? null;
      if (cleaned || !el) {
        return;
      }

      resolvedElement = el;

      observer = new ResizeObserver(async entries => {
        await emit(entries[0]);
      });
      observer.observe(resolvedElement);

      void emit();
    })();

    return cleanup;
  }, { name: "resize" });
}
