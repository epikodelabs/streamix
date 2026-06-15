import { atom, createAsyncIterator, isPromiseLike, type AtomBase, type MaybePromise } from "@epikodelabs/streamix";

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
 * @returns {Atom<{ width: number; height: number }>}
 */
export function onResize(
  element: MaybePromise<HTMLElement>
): AtomBase<{ width: number; height: number }> {
  const atom$ = atom<{ width: number; height: number }>();
  
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

    atom$.next({ width, height });
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  (atom$ as any).subscribe = (
    callback?: (value: any) => void
  ) => {
    const callbackFn = (value: { width: number; height: number }) => callback?.(value);

    const subscription = (originalSubscribe as any).call(atom$, callbackFn);

    scheduleStart();

    const baseUnsubscribe = subscription.unsubscribe.bind(subscription);
    let cleaned = false;

    subscription.unsubscribe = () => {
      if (!cleaned) {
        cleaned = true;

        subscriberCount = Math.max(0, subscriberCount - 1);
        if (subscriberCount === 0) {
          stop();
        }

        // Some specs expect teardown to run synchronously.
        const teardown = subscription.teardown;
        subscription.teardown = undefined;
        try {
          teardown?.();
        } catch {
        }

        ;
      }

      return baseUnsubscribe();
    };

    return subscription;
  };

  (atom$ as any)[Symbol.asyncIterator] = () =>
    createAsyncIterator({ register: (observer) => atom$.subscribe((value) => observer.next(value)) })();

  (atom$ as any).name = "onResize";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<{ width: number; height: number }>;
}


