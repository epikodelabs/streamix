import {
  createAsyncGenerator,
  createSubject,
  isPromiseLike,
  MaybePromise,
  Receiver,
  Stream
} from "@actioncrew/streamix";

/**
 * Creates a reactive stream that emits `true` or `false` whenever a CSS media
 * query matches or stops matching.
 *
 * This stream is useful for reacting to viewport size changes, orientation
 * changes, or other media feature conditions.
 *
 * **Behavior:**
 * - Resolves the media query once on first subscription.
 * - Emits the initial match state on start.
 * - Emits on every media query change.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param mediaQueryString A CSS media query string (or promise).
 * @returns {Stream<boolean>} A stream emitting match state.
 */
export function onMediaQuery(
  mediaQueryString: MaybePromise<string>
): Stream<boolean> {
  const subject = createSubject<boolean>();
  subject.name = "onMediaQuery";

  let subscriberCount = 0;
  let stopped = true;

  let mql: MediaQueryList | null = null;
  let listener: ((e: MediaQueryListEvent) => void) | null = null;

  const start = async () => {
    if (!stopped) return;
    stopped = false;

    // SSR / unsupported guard
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = isPromiseLike(mediaQueryString)
      ? await mediaQueryString
      : mediaQueryString;

    if (stopped) return;

    mql = window.matchMedia(query);
    subject.next(mql.matches); // initial emit

    listener = (event: MediaQueryListEvent) => {
      subject.next(event.matches);
    };

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", listener);
    } else {
      // Safari / legacy fallback
      (mql as any).addListener(listener);
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (mql && listener) {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", listener);
      } else {
        (mql as any).removeListener(listener);
      }
    }

    mql = null;
    listener = null;
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
