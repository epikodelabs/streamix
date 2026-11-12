import { fromPush, type Readable } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits `true` or `false` whenever a CSS media
 * query matches or stops matching.
 *
 * This stream is useful for reacting to viewport size changes, orientation
 * changes, or other media feature conditions.
 *
 * **Behavior:**
 * - Reads the media query once on first subscription.
 * - Emits the initial match state on start.
 * - Emits on every media query change.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param mediaQueryString A CSS media query string.
 * @returns {Readable<boolean>} An atom emitting match state.
 */
export function mediaQuery(
  query: string
): Readable<boolean> {
  /* -------------------------------------------------- */
  /* Immediate environment check (required by tests)    */
  /* -------------------------------------------------- */

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    console.warn('matchMedia is not supported in this environment');
    return fromPush<boolean>(() => () => {}, { name: 'mediaQuery' });
  }

  return fromPush<boolean>((sink) => {
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
      await sink.next(value);
    };

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

    return cleanup;
  }, { name: 'mediaQuery' });
}
