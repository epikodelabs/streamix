import { createAsyncIterator, createSubject, isPromiseLike, type MaybePromise, type Receiver, type Stream } from "@epikodelabs/streamix";

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
  
  let subscriberCount = 0;
  let active = false;

  let resolvedElement: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;

  /* -------------------------------------------------- */
  /* Helpers                                            */
  /* -------------------------------------------------- */

  const emit = (entry?: ResizeObserverEntry) => {
    if (!resolvedElement) return;

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
      const rect = resolvedElement.getBoundingClientRect();
      width = Math.round(rect.width);
      height = Math.round(rect.height);
    }

    subject.next({ width, height });
  };

  /* -------------------------------------------------- */
  /* Lifecycle                                          */
  /* -------------------------------------------------- */

  const start = () => {
    if (active) return;
    active = true;

    // SSR / unsupported
    if (typeof ResizeObserver === "undefined") {
      active = false;
      return;
    }

    if (isPromiseLike(element)) {
      // Async: wait for element resolution
      void (async () => {
        const el = await element;
        if (!active || !el) return;

        resolvedElement = el;
        observer = new ResizeObserver(entries => emit(entries[0]));
        observer.observe(resolvedElement);
        
        if (active) emit();
      })();
    } else {
      // Sync: setup immediately, defer emission
      resolvedElement = element;
      observer = new ResizeObserver(entries => emit(entries[0]));
      observer.observe(resolvedElement);
      
      if (active) emit();
    }
  };

  const stop = () => {
    if (!active) return;
    active = false;

    observer?.disconnect();
    observer = null;
    resolvedElement = null;
  };

  /* -------------------------------------------------- */
  /* Ref-counted subscription override                  */
  /* -------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  subject.subscribe = (
    cb?: ((value: { width: number; height: number }) => void) |
      Receiver<{ width: number; height: number }>
  ) => {
    const sub = (originalSubscribe as any).call(subject, cb);

    scheduleStart();

    const baseUnsubscribe = sub.unsubscribe.bind(sub);
    let cleaned = false;

    sub.unsubscribe = () => {
      if (!cleaned) {
        cleaned = true;

        subscriberCount = Math.max(0, subscriberCount - 1);
        if (subscriberCount === 0) {
          stop();
        }

        // Some DOM specs expect the teardown callback to run synchronously.
        const teardown = sub.teardown;
        sub.teardown = undefined;
        try {
          teardown?.();
        } catch {
        }
      }

      return baseUnsubscribe();
    };

    return sub;
  };

  /* -------------------------------------------------- */
  /* Async iteration support                            */
  /* -------------------------------------------------- */

  subject[Symbol.asyncIterator] = () =>
    createAsyncIterator({ register: (receiver: Receiver<any>) => subject.subscribe(receiver) })();

  subject.name = "onResize";
  subject.type = "stream";
  return subject;
}


