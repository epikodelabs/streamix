import { createAsyncIterator, createSubject, type Receiver, type Stream } from "@epikodelabs/streamix";

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
 * @returns {Stream<DocumentVisibilityState>}
 */
export function onVisibilityChange(): Stream<DocumentVisibilityState> {
  const subject = createSubject<DocumentVisibilityState>();
  subject.name = "onVisibilityChange";

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
    subject.next(getState());
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

  const originalSubscribe = subject.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  subject.subscribe = (
    cb?: ((value: DocumentVisibilityState) => void) | Receiver<DocumentVisibilityState>
  ) => {
    const sub = originalSubscribe.call(subject, cb);

    scheduleStart();

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
    createAsyncIterator({ register: (receiver: Receiver<any>) => subject.subscribe(receiver) })();

  return subject;
}


