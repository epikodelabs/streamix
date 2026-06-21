import { createSharedSource, type Atom } from "@epikodelabs/streamix";

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
export function onNetwork(): Atom<NetworkState> {
  return createSharedSource<NetworkState>((push) => {
    let cleaned = false;
    let connection: any = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      if (typeof window === "undefined") return;

      window.removeEventListener("online", emit);
      window.removeEventListener("offline", emit);
      connection?.removeEventListener?.("change", emit);

      connection = null;
    };

    const snapshot = (): NetworkState => ({
      online:
        typeof navigator !== "undefined" ? navigator.onLine : false,
      type: connection?.type,
      effectiveType: connection?.effectiveType,
      downlink: connection?.downlink,
      rtt: connection?.rtt,
      saveData: connection?.saveData
    });

    const emit = async () => {
      if (cleaned) return;
      await push(snapshot());
    };

    // SSR / unsupported guard
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return cleanup;
    }

    connection = (navigator as any).connection ?? null;

    window.addEventListener("online", emit);
    window.addEventListener("offline", emit);
    connection?.addEventListener?.("change", emit);

    void emit();

    return cleanup;
  }, { name: "onNetwork" });
}
