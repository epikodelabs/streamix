import {
    atom,
    createAsyncIterator,
    isPromiseLike,
    type AtomBase,
    type MaybePromise,
    type Receiver,
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
 * @returns {Atom<boolean>} An atom emitting intersection state.
 */
export function onIntersection(
  element: MaybePromise<Element>,
  options?: MaybePromise<IntersectionObserverInit>
): AtomBase<boolean> {
  const atom$ = atom<boolean>(false, { discrete: true });

  let subscriberCount = 0;
  let active = false;

  let io: IntersectionObserver | null = null;
  let mo: MutationObserver | null = null;
  let lastValue: boolean | undefined;
  let hasEmitted = false;

  const emit = (value: boolean) => {
    if (value === lastValue) return;
    lastValue = value;
    hasEmitted = true;
    atom$.next(value);
  };

  const computeInitial = (el: Element): boolean => {
    if (typeof window === "undefined") return false;
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  };

  const stop = () => {
    if (!active) return;
    active = false;

    try {
      io?.disconnect();
    } catch {}
    try {
      mo?.disconnect();
    } catch {}

    io = null;
    mo = null;
    lastValue = undefined;
    hasEmitted = false;
  };

  const start = async () => {
    if (active) return;
    active = true;

    if (
      typeof IntersectionObserver === "undefined" ||
      typeof document === "undefined"
    ) {
      active = false;
      return;
    }

    const el = (isPromiseLike(element) ? await element : element) ?? null;
    const resolvedOptions = isPromiseLike(options) ? await options : options;

    if (!active || !el) {
      stop();
      return;
    }

    io = new IntersectionObserver((entries) => {
      emit(entries[0]?.isIntersecting ?? false);
    }, resolvedOptions);
    io.observe(el);

    if (!hasEmitted) {
      emit(computeInitial(el));
    }

    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => {
        if (!document.body.contains(el)) {
          stop();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  };

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      // Defer startup so callers can assign the returned subscription before
      // any synchronous observer callbacks fire.
      queueMicrotask(() => {
        if (subscriberCount > 0) {
          void start();
        }
      });
    }
  };

  (atom$ as any).subscribe = (
    callback?: ((value: boolean) => void) | Receiver<boolean>
  ) => {
    const receiver: Receiver<boolean> | undefined =
      typeof callback === "function" ? { next: callback } : callback;

    const callbackFn = (value: boolean) => receiver?.next?.(value);

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

        const teardown = subscription.teardown;
        subscription.teardown = undefined;
        try {
          teardown?.();
        } catch {}

        receiver?.complete?.();
      }

      return baseUnsubscribe();
    };

    return subscription;
  };

  (atom$ as any)[Symbol.asyncIterator] = () =>
    createAsyncIterator({
      register: (receiver: Receiver<any>) => atom$.subscribe(receiver as any),
    })();

  (atom$ as any).name = "onIntersection";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<boolean>;
}
