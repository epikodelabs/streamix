import { createSharedSource, isPromiseLike, type Atom, type MaybePromise } from "@epikodelabs/streamix";

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
export function mediaQuery(
  query: MaybePromise<string>
): Atom<boolean> {
  /* -------------------------------------------------- */
  /* Immediate environment check (required by tests)    */
  /* -------------------------------------------------- */

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    console.warn('matchMedia is not supported in this environment');
    return createSharedSource<boolean>(() => () => {}, { name: 'mediaQuery' });
  }

  return createSharedSource<boolean>((push) => {
    let cleaned = false;
    let mql: MediaQueryList | null = null;
    let listener: ((e: MediaQueryListEvent) => void) | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

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

    const emit = async (value: boolean) => {
      if (cleaned) return;
      await push(value);
    };

    if (isPromiseLike(query)) {
      // Async path for promise query
      void emit(false);

      void (async () => {
        const q = await query;
        if (cleaned) return;

        mql = window.matchMedia(q);
        await emit(mql.matches);

        listener = async (e: MediaQueryListEvent) => {
          if (cleaned) return;
          await emit(e.matches);
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

      listener = async (e: MediaQueryListEvent) => {
        if (cleaned) return;
        await emit(e.matches);
      };

      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', listener);
      } else if (typeof (mql as any).addListener === 'function') {
        (mql as any).addListener(listener);
      }

      void emit(mql.matches);
    }

    return cleanup;
  }, { name: 'mediaQuery' });
}
