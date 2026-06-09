import { asyncAtom, createStream, isPromiseLike, iterate, type MaybePromise, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits `true` or `false` whenever a CSS media
 * query matches or stops matching.
 *
 * **Behavior:**
 * - Resolves the media query string once on first subscription.
 * - Emits the initial match state on start.
 * - Emits on every media query change.
 * - Stops listening when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param query A CSS media query string (or promise resolving to one).
 * @returns {Stream<boolean>} A stream emitting match state.
 */
export function onMediaQuery(query: MaybePromise<string>): Stream<boolean> {
  return createStream<boolean>("onMediaQuery", async function* (signal) {
    // SSR / unsupported guard
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      if (typeof window !== "undefined") {
        console.warn("matchMedia is not supported in this environment");
      }
      return;
    }

    const isPromise = isPromiseLike(query);
    if (isPromise) {
      yield false;
    }

    const queryString = isPromise ? await (query as Promise<string>) : (query as string);

    if (signal?.aborted) return;

    const atom = asyncAtom<boolean>();

    const mql = window.matchMedia(queryString);

    const listener = (e: MediaQueryListEvent) => {
      if (signal?.aborted) {
        return;
      }
      atom.set(e.matches);
    };

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (signal) {
        signal.removeEventListener("abort", cleanup);
      }
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", listener);
      } else {
        (mql as any).removeListener(listener);
      }
      atom.dispose();
    };

    if (signal) {
      signal.addEventListener("abort", cleanup, { once: true });
    }

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", listener);
    } else {
      // Safari < 14 fallback
      (mql as any).addListener(listener);
    }

    // Emit initial state
    atom.set(mql.matches);

    try {
      yield* { [Symbol.asyncIterator]: () => iterate(atom, signal) };
    } finally {
      cleanup();
    }
  });
}
