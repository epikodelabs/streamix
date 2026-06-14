import { atom, createAsyncIterator, type AtomBase, type Receiver } from "@epikodelabs/streamix";

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
 * @returns {Atom<NetworkState>}
 */
export function onNetwork(): AtomBase<NetworkState> {
  const atom$ = atom<NetworkState>();


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
    atom$.next(snapshot());
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  (atom$ as any).subscribe = (
    callback?: ((value: NetworkState) => void) | Receiver<NetworkState>
  ) => {
    const callbackFn = typeof callback === "function"
      ? callback
      : (value: NetworkState) => callback?.next?.(value);

    const sub = (originalSubscribe as any).call(atom$, callbackFn);

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
    createAsyncIterator({ register: (receiver: Receiver<any>) => atom$.subscribe(receiver as any) })();

  (atom$ as any).name = "onNetwork";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<NetworkState>;
}


