import { createAsyncGenerator, createSubject, isPromiseLike, type MaybePromise, type Receiver, type Stream } from "@epikodelabs/streamix";

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
  query: MaybePromise<string>
): Stream<boolean> {
  const subject = createSubject<boolean>();
  subject.name = 'onMediaQuery';

  let subscriberCount = 0;
  let active = false;
  let initialEmitPending = false;

  let mql: MediaQueryList | null = null;
  let listener: ((e: MediaQueryListEvent) => void) | null = null;

  /* -------------------------------------------------- */
  /* Immediate environment check (required by tests)    */
  /* -------------------------------------------------- */

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    console.warn('matchMedia is not supported in this environment');
    return subject;
  }

  /* -------------------------------------------------- */
  /* Lifecycle                                          */
  /* -------------------------------------------------- */

  const start = () => {
    if (active) return;
    active = true;

    if (isPromiseLike(query)) {
      // Async path for promise query
      subject.next(false); // Emit false immediately
      void (async () => {
        const q = await query;
        if (!active) return;

        mql = window.matchMedia(q);
        subject.next(mql.matches);

        listener = (e: MediaQueryListEvent) => {
          subject.next(e.matches);
        };

        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', listener);
        } else if (typeof (mql as any).addListener === 'function') {
          (mql as any).addListener(listener);
        }
      })();
    } else {
      // Synchronous path for immediate query
      mql = window.matchMedia(query);

      listener = (e: MediaQueryListEvent) => {
        subject.next(e.matches);
      };

      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', listener);
      } else if (typeof (mql as any).addListener === 'function') {
        (mql as any).addListener(listener);
      }
      
      if (!initialEmitPending) {
        initialEmitPending = true;
        queueMicrotask(() => {
          initialEmitPending = false;
          if (active && mql) subject.next(mql.matches);
        });
      }
    }
  };

  const stop = () => {
    if (!active) return;
    active = false;

    if (mql && listener) {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', listener);
      } else if (typeof (mql as any).removeListener === 'function') {
        (mql as any).removeListener(listener);
      }
    }

    mql = null;
    listener = null;
  };

  /* -------------------------------------------------- */
  /* Ref-counted subscribe override                     */
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

    scheduleStart();

    const prev = sub.onUnsubscribe;
    sub.onUnsubscribe = () => {
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
    createAsyncGenerator(r => subject.subscribe(r));

  return subject;
}


