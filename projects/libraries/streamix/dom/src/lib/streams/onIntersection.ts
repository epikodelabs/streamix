import { createAsyncIterator, createSubject, isPromiseLike, type MaybePromise, type Receiver, type Stream } from "@epikodelabs/streamix";

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
  let active = false;

  let el: Element | null = null;
  let io: IntersectionObserver | null = null;
  let mo: MutationObserver | null = null;

  const subscriptions = new Set<{ unsubscribe: () => void }>();

  /* -------------------------------------------------- */

  const start = () => {
    if (active) return;
    active = true;

    if (
      typeof IntersectionObserver === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }

    if (isPromiseLike(element) || isPromiseLike(options)) {
      // Async path for promise element/options
      void (async () => {
        el = isPromiseLike(element) ? await element : element;
        const resolvedOptions = isPromiseLike(options) ? await options : options;

        if (!active || !el) return;

        io = new IntersectionObserver(entries => {
          subject.next(entries[0]?.isIntersecting ?? false);
        }, resolvedOptions);

        io.observe(el);

        // ???? REQUIRED: detect DOM removal
        mo = new MutationObserver(() => {
          if (el && !document.body.contains(el)) {
            // Force-unsubscribe ALL subscribers
            for (const sub of subscriptions) {
              sub.unsubscribe();
            }
            subscriptions.clear();
            stop();
          }
        });

        mo.observe(document.body, { childList: true, subtree: true });
      })();
    } else {
      // Synchronous path for immediate element/options
      el = element;
      const resolvedOptions = options;

      io = new IntersectionObserver(entries => {
        subject.next(entries[0]?.isIntersecting ?? false);
      }, resolvedOptions);

      io.observe(el);
      
      // Emit initial value immediately
      if (active && io) {
        // Trigger initial observation synchronously
        const rect = el!.getBoundingClientRect();
        subject.next(rect.top < window.innerHeight && rect.bottom > 0);
      }

      // ???? REQUIRED: detect DOM removal
      mo = new MutationObserver(() => {
        if (el && !document.body.contains(el)) {
          // Force-unsubscribe ALL subscribers
          for (const sub of subscriptions) {
            sub.unsubscribe();
          }
          subscriptions.clear();
          stop();
        }
      });

      mo.observe(document.body, { childList: true, subtree: true });
    }
  };

  const stop = () => {
    if (!active) return;
    active = false;

    if (io && el) {
      io.unobserve(el);
      io.disconnect();
    }

    mo?.disconnect();

    io = null;
    mo = null;
    el = null;
  };

  /* -------------------------------------------------- */
  /* Ref-counted subscription handling                  */
  /* -------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  subject.subscribe = (
    cb?: ((value: boolean) => void) | Receiver<boolean>
  ) => {
    const sub = originalSubscribe.call(subject, cb);

    subscriptions.add(sub);

    scheduleStart();

    const prev = sub.onUnsubscribe;
    sub.onUnsubscribe = () => {
      subscriptions.delete(sub);

      if (--subscriberCount === 0) {
        stop();
      }

      prev?.call(sub);
    };

    return sub;
  };

  /* -------------------------------------------------- */
  /* Async iteration support                            */
  /* -------------------------------------------------- */

  subject[Symbol.asyncIterator] = () =>
    createAsyncIterator({ register: (r: Receiver<any>) => subject.subscribe(r) })();

  return subject;
}

