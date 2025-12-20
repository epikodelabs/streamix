import {
  createAsyncGenerator,
  createSubject,
  isPromiseLike,
  MaybePromise,
  Receiver,
  Stream
} from "@actioncrew/streamix";

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
  const subject = createSubject<boolean>();
  subject.name = "onIntersection";

  let subscriberCount = 0;
  let stopped = true;

  let resolvedElement: Element | null = null;
  let resolvedOptions: IntersectionObserverInit | undefined;
  let observer: IntersectionObserver | null = null;

  const start = async () => {
    if (!stopped) return;
    stopped = false;

    // SSR / unsupported guard
    if (
      typeof IntersectionObserver === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }

    resolvedElement = isPromiseLike(element) ? await element : element;
    resolvedOptions = isPromiseLike(options) ? await options : options;

    if (stopped || !resolvedElement) return;

    observer = new IntersectionObserver(entries => {
      subject.next(entries[0]?.isIntersecting ?? false);
    }, resolvedOptions);

    observer.observe(resolvedElement);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (observer && resolvedElement) {
      observer.unobserve(resolvedElement);
      observer.disconnect();
    }

    observer = null;
    resolvedElement = null;
  };

  /* ------------------------------------------------------------------------
   * Ref-counted subscription handling
   * ---------------------------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  subject.subscribe = (
    cb?: ((value: boolean) => void) | Receiver<boolean>
  ) => {
    const sub = originalSubscribe.call(subject, cb);

    if (++subscriberCount === 1) {
      void start();
    }

    const o = sub.onUnsubscribe;
    sub.onUnsubscribe = () => {
      if (--subscriberCount === 0) {
        stop();
      }
      o?.call(sub);
    };

    return sub;
  };

  /* ------------------------------------------------------------------------
   * Async iteration support
   * ---------------------------------------------------------------------- */

  subject[Symbol.asyncIterator] = () =>
    createAsyncGenerator(receiver => subject.subscribe(receiver));

  return subject;
}
