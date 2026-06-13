import {
  createStream,
  isPromiseLike,
  type MaybePromise,
  type Stream,
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

    let done = false;
    let pending: (() => void) | null = null;
    const queue: boolean[] = [];

    const notify = () => {
      const r = pending;
      pending = null;
      r?.();
    };

    let last: boolean | undefined;
    const emit = (v: boolean) => {
      if (done) return;
      if (last === v) return;
      last = v;
      queue.push(v);
      notify();
    };

    const computeInitial = (): boolean => {
      if (typeof window === "undefined") return false;
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    };

    let io: IntersectionObserver | null = null;
    let mo: MutationObserver | null = null;
    let hasEmitted = false;

    const stop = () => {
      if (done) return;
      done = true;
      try {
        io?.disconnect();
      } catch {}
      try {
        mo?.disconnect();
      } catch {}
      io = null;
      mo = null;
      notify();
    };

    const abortPromise =
      signal &&
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true })
      );

    try {
      io = new IntersectionObserver((entries) => {
        hasEmitted = true;
        emit(entries[0]?.isIntersecting ?? false);
      }, resolvedOptions);

      io.observe(el);

      if (!hasEmitted) {
        emit(computeInitial());
      }

      if (typeof MutationObserver !== "undefined") {
        mo = new MutationObserver(() => {
          if (!document.body.contains(el)) {
            stop();
          }
        });
        mo.observe(document.body, { childList: true, subtree: true });
      }

      while (!done && !signal?.aborted) {
        if (queue.length === 0) {
          const wait = new Promise<void>((resolve) => {
            pending = resolve;
          });
          if (abortPromise) {
            await Promise.race([wait, abortPromise]);
          } else {
            await wait;
          }
          continue;
        }

        yield queue.shift()!;
      }
    } finally {
      stop();
    }
  });
}
