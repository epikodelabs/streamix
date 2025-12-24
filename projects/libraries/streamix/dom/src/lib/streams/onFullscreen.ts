import { createAsyncGenerator, createSubject, type Receiver, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits fullscreen state changes.
 *
 * Emits `true` when entering fullscreen and `false` when exiting.
 *
 * **Behavior:**
 * - Emits the initial fullscreen state on start.
 * - Emits on every fullscreen change.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Supports vendor-prefixed implementations.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<boolean>}
 */
export function onFullscreen(): Stream<boolean> {
  const subject = createSubject<boolean>();

  let subscriberCount = 0;
  let stopped = true;

  /**
   * Checks whether the document is currently in fullscreen mode.
   */
  const isFullscreen = (): boolean => {
    if (typeof document === "undefined") return false;

    return !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
  };

  const emit = () => {
    subject.next(isFullscreen());
  };

  const start = () => {
    if (!stopped) return;
    stopped = false;

    // SSR guard
    if (typeof document === "undefined") return;

    document.addEventListener("fullscreenchange", emit);
    document.addEventListener("webkitfullscreenchange", emit as any);
    document.addEventListener("mozfullscreenchange", emit as any);
    document.addEventListener("MSFullscreenChange", emit as any);

    emit(); // initial state
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (typeof document === "undefined") return;

    document.removeEventListener("fullscreenchange", emit);
    document.removeEventListener("webkitfullscreenchange", emit as any);
    document.removeEventListener("mozfullscreenchange", emit as any);
    document.removeEventListener("MSFullscreenChange", emit as any);
  };

  /* ------------------------------------------------------------------------
   * Ref-counted subscription handling
   * ---------------------------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  subject.subscribe = (
    cb?: ((v: boolean) => void) | Receiver<boolean>
  ) => {
    const sub = originalSubscribe.call(subject, cb);

    if (++subscriberCount === 1) {
      start();
    }

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
    createAsyncGenerator(receiver => subject.subscribe(receiver));

  subject.name = "onFullscreen";
  return subject;
}


