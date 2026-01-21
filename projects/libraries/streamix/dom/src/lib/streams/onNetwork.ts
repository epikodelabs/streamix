import { createAsyncGenerator, createSubject, type Receiver, type Stream } from "@epikodelabs/streamix";

/**
 * Represents a snapshot of the current network state.
 */
export type NetworkState = {
  online: boolean;
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

/**
 * Creates a reactive stream that emits network connectivity changes.
 *
 * This stream combines:
 * - `online` / `offline` events
 * - Network Information API (when available)
 *
 * **Behavior:**
 * - Emits an initial snapshot on start.
 * - Emits whenever connectivity or connection quality changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Gracefully degrades when Network Information API is unavailable.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<NetworkState>}
 */
export function onNetwork(): Stream<NetworkState> {
  const subject = createSubject<NetworkState>();
  subject.name = "onNetwork";

  let subscriberCount = 0;
  let stopped = true;

  let connection: any = null;

  const snapshot = (): NetworkState => ({
    online:
      typeof navigator !== "undefined" ? navigator.onLine : false,
    type: connection?.type,
    effectiveType: connection?.effectiveType,
    downlink: connection?.downlink,
    rtt: connection?.rtt,
    saveData: connection?.saveData
  });

  const emit = () => {
    subject.next(snapshot());
  };

  const start = () => {
    if (!stopped) return;
    stopped = false;

    // SSR / unsupported guard
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return;
    }

    connection = (navigator as any).connection ?? null;

    window.addEventListener("online", emit);
    window.addEventListener("offline", emit);
    connection?.addEventListener?.("change", emit);

    emit();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (typeof window === "undefined") return;

    window.removeEventListener("online", emit);
    window.removeEventListener("offline", emit);
    connection?.removeEventListener?.("change", emit);

    connection = null;
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
    cb?: ((value: NetworkState) => void) | Receiver<NetworkState>
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
    createAsyncGenerator(receiver => subject.subscribe(receiver));

  return subject;
}


