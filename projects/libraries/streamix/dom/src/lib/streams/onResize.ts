import { asyncAtom, createStream, isPromiseLike, iterate, type MaybePromise, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the dimensions of a given DOM element
 * whenever it is resized.
 *
 * **Behavior:**
 * - Resolves the element once on first subscription.
 * - Emits the current width and height on start and on every resize.
 * - Prefers `contentBoxSize` over the deprecated `contentRect`.
 * - Stops observing when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @returns {Stream<{ width: number; height: number }>}
 */
export function onResize(
  element: MaybePromise<HTMLElement>
): Stream<{ width: number; height: number }> {
  return createStream<{ width: number; height: number }>(
    "onResize",
    async function* (signal) {
      // SSR / unsupported guard
      if (typeof ResizeObserver === "undefined") return;

      const el = isPromiseLike(element) ? await element : element;

      if (signal?.aborted || !el) return;

      const atom = asyncAtom<{ width: number; height: number }>();

      const measure = (entry?: ResizeObserverEntry) => {
        if (signal?.aborted) {
          return;
        }
        let width: number;
        let height: number;

        if (entry?.contentBoxSize?.length) {
          const box = entry.contentBoxSize[0];
          width = Math.round(box.inlineSize);
          height = Math.round(box.blockSize);
        } else if (entry?.contentRect) {
          width = Math.round(entry.contentRect.width);
          height = Math.round(entry.contentRect.height);
        } else {
          const rect = el.getBoundingClientRect();
          width = Math.round(rect.width);
          height = Math.round(rect.height);
        }

        atom.set({ width, height });
      };

      const observer = new ResizeObserver((entries) => measure(entries[0]));

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
        atom.dispose();
      };

      if (signal) {
        signal.addEventListener("abort", cleanup, { once: true });
      }

      observer.observe(el);

      // Emit initial size
      measure();

      try {
        yield* { [Symbol.asyncIterator]: () => iterate(atom, signal) };
      } finally {
        cleanup();
      }
    }
  );
}
