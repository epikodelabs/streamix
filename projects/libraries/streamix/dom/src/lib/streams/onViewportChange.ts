import { createAsyncIterator, createSubject, type Receiver, type Stream } from "@epikodelabs/streamix";

/**
 * Represents a snapshot of the visual viewport.
 */
export type ViewportState = {
  width: number;
  height: number;
  scale: number;
  offsetLeft: number;
  offsetTop: number;
};

/**
 * Creates a reactive stream that emits changes to the visual viewport.
 *
 * Uses `visualViewport` when available, falling back to `window`.
 *
 * **Behavior:**
 * - Emits initial viewport metrics on start.
 * - Emits on resize, scroll, and zoom.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<ViewportState>}
 */
export function onViewportChange(): Stream<ViewportState> {
  const subject = createSubject<ViewportState>();
  subject.name = "onViewportChange";

  let subscriberCount = 0;
  let stopped = true;

  let target: VisualViewport | Window | null = null;

  const snapshot = (): ViewportState => {
    if (typeof window === "undefined") {
      return {
        width: 0,
        height: 0,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0
      };
    }

    if (window.visualViewport) {
      const vp = window.visualViewport;
      return {
        width: vp.width,
        height: vp.height,
        scale: vp.scale,
        offsetLeft: vp.offsetLeft,
        offsetTop: vp.offsetTop
      };
    }

    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0
    };
  };

  const emit = () => {
    subject.next(snapshot());
  };

  const start = () => {
    if (!stopped) return;
    stopped = false;

    // SSR guard
    if (typeof window === "undefined") return;

    target = window.visualViewport ?? window;

    target.addEventListener("resize", emit);
    target.addEventListener("scroll", emit);

    emit();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (!target) return;

    target.removeEventListener("resize", emit);
    target.removeEventListener("scroll", emit);

    target = null;
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
    cb?: ((value: ViewportState) => void) | Receiver<ViewportState>
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


