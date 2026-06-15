import { atom, createAsyncIterator, type AtomBase } from "@epikodelabs/streamix";

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
 * @returns {Atom<"portrait" | "landscape">}
 */
export function onOrientation(): AtomBase<"portrait" | "landscape"> {
  const atom$ = atom<"portrait" | "landscape">();

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
    atom$.next(getOrientation());
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  (atom$ as any).subscribe = (
    callback?: (value: "portrait" | "landscape") => void
  ) => {
    const subscription = (originalSubscribe as any).call(atom$, callback);

    scheduleStart();

    const baseUnsubscribe = subscription.unsubscribe.bind(subscription);
    let cleaned = false;

    subscription.unsubscribe = () => {
      if (!cleaned) {
        cleaned = true;

        subscriberCount = Math.max(0, subscriberCount - 1);
        if (subscriberCount === 0) {
          stop();
        }

        // Some specs expect teardown to run synchronously.
        const teardown = subscription.teardown;
        subscription.teardown = undefined;
        try {
          teardown?.();
        } catch {
        }
      }

      return baseUnsubscribe();
    };

    return subscription;
  };

  (atom$ as any)[Symbol.asyncIterator] = () =>
    createAsyncIterator({ register: (observer) => atom$.subscribe((value: any) => observer.next(value)) })();

  (atom$ as any).name = "onOrientation";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<"portrait" | "landscape">;
}


