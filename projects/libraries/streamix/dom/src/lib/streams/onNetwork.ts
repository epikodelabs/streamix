import { asyncAtom, createStream, iterate, type Stream } from "@epikodelabs/streamix";

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
 * Combines `online` / `offline` window events with the Network Information
 * API (when available).
 *
 * **Behavior:**
 * - Emits an initial snapshot on start.
 * - Emits whenever connectivity or connection quality changes.
 * - Gracefully degrades when the Network Information API is unavailable.
 * - Stops listening when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<NetworkState>}
 */
export function onNetwork(): Stream<NetworkState> {
  return createStream<NetworkState>("onNetwork", async function* (signal) {
    // SSR / unsupported guard
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return;
    }

    const atom = asyncAtom<NetworkState>();

    const connection: any = (navigator as any).connection ?? null;

    const snapshot = (): NetworkState => ({
      online: navigator.onLine,
      type: connection?.type,
      effectiveType: connection?.effectiveType,
      downlink: connection?.downlink,
      rtt: connection?.rtt,
      saveData: connection?.saveData,
    });

    const emit = () => {
      if (signal?.aborted) {
        return;
      }
      atom.set(snapshot());
    };

    window.addEventListener("online", emit);
    window.addEventListener("offline", emit);
    connection?.addEventListener?.("change", emit);

    // Emit initial snapshot
    emit();

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (signal) {
        try {
          signal.removeEventListener("abort", cleanup);
        } catch {
          // ignore
        }
      }
      try {
        window.removeEventListener("online", emit);
      } catch {
        // ignore
      }
      try {
        window.removeEventListener("offline", emit);
      } catch {
        // ignore
      }
      try {
        connection?.removeEventListener?.("change", emit);
      } catch {
        // ignore
      }
      atom.dispose();
    };

    if (signal) {
      signal.addEventListener("abort", cleanup, { once: true });
    }

    try {
      yield* { [Symbol.asyncIterator]: () => iterate(atom, signal) };
    } finally {
      cleanup();
    }
  });
}
