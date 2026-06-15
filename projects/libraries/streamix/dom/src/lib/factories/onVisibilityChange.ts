import { atom, createAsyncIterator, type AtomBase } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the document's visibility state
 * whenever it changes.
 *
 * This stream is useful for:
 * - pausing animations or polling when the page is hidden
 * - throttling background work
 * - detecting tab switching or minimization
 *
 * **Behavior:**
 * - Emits the current visibility state on start.
 * - Emits on every `visibilitychange` event.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Atom<DocumentVisibilityState>}
 */
export function onVisibilityChange(): AtomBase<DocumentVisibilityState> {
  const atom$ = atom<DocumentVisibilityState>();

  let subscriberCount = 0;
  let stopped = true;

  const getState = (): DocumentVisibilityState => {
    if (typeof document === "undefined") {
      return "visible";
    }

    const state = (document as any).visibilityState;
    if (state === "visible" || state === "hidden") {
      return state;
    }
    return "visible";
  };

  const emit = () => {
    atom$.next(getState());
  };

  const start = () => {
    if (!stopped) return;
    stopped = false;

    // SSR / unsupported guard
    if (typeof document === "undefined") return;

    document.addEventListener("visibilitychange", emit);
    
    emit();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (typeof document === "undefined") return;

    document.removeEventListener("visibilitychange", emit);
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
    callback?: (value: DocumentVisibilityState) => void
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
    createAsyncIterator({ register: (observer) => atom$.subscribe((value: any) => observer.next(value)) })();

  (atom$ as any).name = "onVisibilityChange";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<DocumentVisibilityState>;
}


