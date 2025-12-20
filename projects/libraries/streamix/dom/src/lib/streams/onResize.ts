import {
  createAsyncGenerator,
  createSubject,
  isPromiseLike,
  MaybePromise,
  Receiver,
  Stream
} from "@actioncrew/streamix";

/**
 * Creates a reactive stream that emits the dimensions of a given DOM element
 * whenever it is resized.
 *
 * This stream is a wrapper around the `ResizeObserver` API.
 *
 * **Behavior:**
 * - Resolves the element once on first subscription.
 * - Emits the current width and height whenever the element is resized.
 * - Emits the initial size on start.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @returns {Stream<{ width: number; height: number }>}
 */
export function onResize(
  element: MaybePromise<HTMLElement>
): Stream<{ width: number; height: number }> {
  const subject = createSubject<{ width: number; height: number }>();
  subject.name = "onResize";

  let subscriberCount = 0;
  let stopped = true;

  let resolvedElement: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;

  const emit = (entry?: ResizeObserverEntry) => {
    if (!resolvedElement) return;

    const rect = entry?.contentRect ?? resolvedElement.getBoundingClientRect();
    subject.next({ width: rect.width, height: rect.height });
  };

  const start = async () => {
    if (!stopped) return;
    stopped = false;

    // SSR / unsupported guard
    if (typeof ResizeObserver === "undefined") return;

    resolvedElement = isPromiseLike(element) ? await element : element;
    if (stopped || !resolvedElement) return;

    observer = new ResizeObserver(entries => {
      emit(entries[0]);
    });

    observer.observe(resolvedElement);
    emit(); // initial size
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    observer?.disconnect();
    observer = null;
    resolvedElement = null;
  };

  /* ------------------------------------------------------------------------
   * Ref-counted subscription handling
   * ---------------------------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  subject.subscribe = (
    cb?: ((value: { width: number; height: number }) => void) |
      Receiver<{ width: number; height: number }>
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
