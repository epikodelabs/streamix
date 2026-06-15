import { atom, createAsyncIterator, type AtomBase } from "@epikodelabs/streamix";

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
 * @returns {Atom<boolean>}
 */
export function onFullscreen(): AtomBase<boolean> {
  const atom$ = atom<boolean>();

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
    atom$.next(isFullscreen());
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

    // Emit initial value immediately
    emit();
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  (atom$ as any).subscribe = (
    callback?: (value: boolean) => void
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

  (atom$ as any).name = "onFullscreen";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<boolean>;
}


