import { atom, createAsyncIterator, type AtomBase } from "@epikodelabs/streamix";

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
 * @returns {Atom<ViewportState>}
 */
export function onViewportChange(): AtomBase<ViewportState> {
  const atom$ = atom<ViewportState>();

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
    atom$.next(snapshot());
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  (atom$ as any).subscribe = (
    callback?: (value: ViewportState) => void
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
  
  (atom$ as any).name = "onViewportChange";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<ViewportState>;
}


