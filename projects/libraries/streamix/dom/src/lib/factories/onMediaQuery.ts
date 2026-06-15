import { atom, createAsyncIterator, isPromiseLike, type AtomBase, type MaybePromise } from "@epikodelabs/streamix";

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
 * @returns {Atom<boolean>} An atom emitting match state.
 */
export function onMediaQuery(
  query: MaybePromise<string>
): AtomBase<boolean> {
  const atom$ = atom<boolean>();

  let subscriberCount = 0;
  let active = false;

  let mql: MediaQueryList | null = null;
  let listener: ((e: MediaQueryListEvent) => void) | null = null;

  /* -------------------------------------------------- */
  /* Immediate environment check (required by tests)    */
  /* -------------------------------------------------- */

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    console.warn('matchMedia is not supported in this environment');
    return atom$ as AtomBase<boolean>;
  }

  /* -------------------------------------------------- */
  /* Lifecycle                                          */
  /* -------------------------------------------------- */

  const start = () => {
    if (active) return;
    active = true;

    if (isPromiseLike(query)) {
      // Async path for promise query
      atom$.next(false); // Emit false immediately
      void (async () => {
        const q = await query;
        if (!active) return;

        mql = window.matchMedia(q);
        atom$.next(mql.matches);

        listener = (e: MediaQueryListEvent) => {
          atom$.next(e.matches);
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
        atom$.next(e.matches);
      };

      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', listener);
      } else if (typeof (mql as any).addListener === 'function') {
        (mql as any).addListener(listener);
      }
      
      if (active && mql) atom$.next(mql.matches);
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  (atom$ as any).subscribe = (
    callback?: (value: boolean) => void
  ) => {
    const sub = (originalSubscribe as any).call(atom$, callback);

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
    createAsyncIterator({ register: (observer) => atom$.subscribe((value) => observer.next(value)) })();

  (atom$ as any).name = 'onMediaQuery';
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<boolean>;
}


