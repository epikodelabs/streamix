import { createAsyncIterator, createSubject, isPromiseLike, type MaybePromise, type Receiver, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits arrays of `MutationRecord` objects
 * whenever mutations are observed on a given DOM element.
 *
 * This stream is a wrapper around the `MutationObserver` API and is useful
 * for reacting to DOM structure or attribute changes.
 *
 * **Behavior:**
 * - Resolves the target element and options once on first subscription.
 * - Emits mutation records whenever changes occur.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @param options Optional MutationObserver options (or promise).
 * @returns {Stream<MutationRecord[]>} A stream of mutation records.
 */
export function onMutation(
  element: MaybePromise<Element>,
  options?: MaybePromise<MutationObserverInit>
): Stream<MutationRecord[]> {
  const subject = createSubject<MutationRecord[]>();

  let subscriberCount = 0;
  let stopped = true;

  let observer: MutationObserver | null = null;
  let generation = 0;

  const start = () => {
    if (!stopped) return;
    stopped = false;

    if (typeof MutationObserver === 'undefined') return;
    const run = ++generation;
    const observe = (target: Element, config?: MutationObserverInit) => {
      if (stopped || generation !== run || !target) return;
      const nextObserver = new MutationObserver(mutations => {
        if (!stopped && generation === run) subject.next([...mutations]);
      });
      try {
        nextObserver.observe(target, config ?? {
          childList: true, subtree: true, attributes: true, characterData: true,
        });
        observer = nextObserver;
      } catch (error) {
        nextObserver.disconnect();
        subject.error(error);
      }
    };

    if (isPromiseLike(element) || isPromiseLike(options)) {
      void Promise.all([element, options]).then(
        ([target, config]) => observe(target, config),
        error => { if (!stopped && generation === run) subject.error(error); },
      );
    } else {
      observe(element, options);
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;

    observer?.disconnect();
    observer = null;
  };

  /* ------------------------------------------------------------------------
   * Ref-counted subscription handling
   * ---------------------------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  subject.subscribe = (
    cb?: ((value: MutationRecord[]) => void) | Receiver<MutationRecord[]>
  ) => {
    const sub = (originalSubscribe as any).call(subject, cb);

    scheduleStart();

    const o = sub.teardown;
    sub.teardown = () => {
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
    createAsyncIterator({ register: (receiver: Receiver<any>) => subject.subscribe(receiver) })();

  subject.name = "onMutation";
  subject.type = "stream";
  return subject;
}


