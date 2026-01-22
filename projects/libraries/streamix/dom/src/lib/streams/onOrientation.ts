import { createAsyncIterator, createSubject, type Receiver, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits the current screen orientation,
 * either `"portrait"` or `"landscape"`, whenever it changes.
 *
 * **Behavior:**
 * - Emits the initial orientation on start.
 * - Emits whenever the orientation changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<"portrait" | "landscape">}
 */
export function onOrientation(): Stream<"portrait" | "landscape"> {
  const subject = createSubject<"portrait" | "landscape">();
  subject.name = "onOrientation";

  let subscriberCount = 0;
  let stopped = true;

  const getOrientation = (): "portrait" | "landscape" => {
    if (
      typeof window === "undefined" ||
      !window.screen ||
      !window.screen.orientation
    ) {
      return "portrait";
    }

    const angle = window.screen.orientation.angle;
    return angle === 0 || angle === 180 ? "portrait" : "landscape";
  };

  const emit = () => {
    subject.next(getOrientation());
  };

  const start = () => {
    if (!stopped) return;
      stopped = false;
      
      if (
        typeof window === "undefined" ||
        !window.screen ||
        !window.screen.orientation
      ) {
        return;
      }

      window.screen.orientation.addEventListener("change", emit);
      
      emit();
    };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (
      typeof window === "undefined" ||
      !window.screen ||
      !window.screen.orientation
    ) {
      return;
    }

    window.screen.orientation.removeEventListener("change", emit);
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
    cb?: ((value: "portrait" | "landscape") => void) | Receiver<"portrait" | "landscape">
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


