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
  let orientation: ScreenOrientation | null = null;

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

    if (typeof window === "undefined" || !window.screen) {
      return;
    }

    // If the Orientation API is unavailable, still emit a sane default once.
    if (!window.screen.orientation) {
      emit();
      return;
    }

    orientation = window.screen.orientation;

    orientation.addEventListener("change", emit);

    emit();
  };

  const stop = () => {
    if (stopped) return;

    stopped = true;

    orientation?.removeEventListener("change", emit);
    orientation = null;
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

    const baseUnsubscribe = sub.unsubscribe.bind(sub);
    let cleaned = false;

    sub.unsubscribe = () => {
      if (!cleaned) {
        cleaned = true;

        subscriberCount = Math.max(0, subscriberCount - 1);
        if (subscriberCount === 0) {
          stop();
        }

        // Some DOM specs expect the onUnsubscribe callback to run synchronously.
        const onUnsubscribe = sub.onUnsubscribe;
        sub.onUnsubscribe = undefined;
        try {
          onUnsubscribe?.();
        } catch {
        }
      }

      return baseUnsubscribe();
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


