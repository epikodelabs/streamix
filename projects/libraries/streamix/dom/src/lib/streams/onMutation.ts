import { atom, createAsyncIterator, isPromiseLike, type AtomBase, type MaybePromise, type Receiver } from "@epikodelabs/streamix";

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
 * @returns {Atom<MutationRecord[]>} An atom of mutation records.
 */
export function onMutation(
  element: MaybePromise<Element>,
  options?: MaybePromise<MutationObserverInit>
): AtomBase<MutationRecord[]> {
  const atom$ = atom<MutationRecord[]>();

  let subscriberCount = 0;
  let stopped = true;

  let resolvedElement: Element | null = null;
  let resolvedOptions: MutationObserverInit | undefined;
  let observer: MutationObserver | null = null;

  const start = () => {
    if (!stopped) return;
    stopped = false;

    // SSR / unsupported guard
    if (typeof MutationObserver === "undefined") return;

    if (isPromiseLike(element) || isPromiseLike(options)) {
      // Async path for promise element/options
      void (async () => {
        resolvedElement = isPromiseLike(element) ? await element : element;
        resolvedOptions = isPromiseLike(options) ? await options : options;

        if (stopped || !resolvedElement) return;

        observer = new MutationObserver(mutations => {
          atom$.next([...mutations]);
        });

        observer.observe(resolvedElement, resolvedOptions);
      })();
    } else {
      // Synchronous path for immediate element/options
      resolvedElement = element;
      resolvedOptions = options;

      observer = new MutationObserver(mutations => {
        atom$.next([...mutations]);
      });

      observer.observe(resolvedElement, resolvedOptions);
    }
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  (atom$ as any).subscribe = (
    callback?: ((value: MutationRecord[]) => void) | Receiver<MutationRecord[]>
  ) => {
    const callbackFn = typeof callback === "function"
      ? callback
      : (value: MutationRecord[]) => callback?.next?.(value);

    const sub = (originalSubscribe as any).call(atom$, callbackFn);

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

  (atom$ as any)[Symbol.asyncIterator] = () =>
    createAsyncIterator({ register: (receiver: Receiver<any>) => atom$.subscribe(receiver as any) })();

  (atom$ as any).name = "onMutation";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<MutationRecord[]>;
}


