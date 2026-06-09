import { asyncAtom, createStream, iterate, type Stream } from "@epikodelabs/streamix";

/**
 * Represents the current battery status.
 */
export type BatteryState = {
  charging: boolean;
  level: number;
  chargingTime: number;
  dischargingTime: number;
};

/**
 * Creates a reactive stream that emits battery state changes.
 *
 * Uses the Battery Status API when available.
 *
 * **Behavior:**
 * - Emits an initial battery snapshot on start.
 * - Emits on charging, level, and time changes.
 * - Stops listening when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<BatteryState>}
 */
export function onBattery(): Stream<BatteryState> {
  return createStream<BatteryState>("onBattery", async function* (signal) {
    // SSR / unsupported API guard
    if (
      typeof navigator === "undefined" ||
      !(navigator as any).getBattery
    ) {
      return;
    }

    let battery: any;
    try {
      battery = await (navigator as any).getBattery();
    } catch {
      // getBattery() rejected — permission denied or unsupported
      return;
    }

    if (signal?.aborted) return;

    const atom = asyncAtom<BatteryState>();

    const emit = () => {
      if (signal?.aborted) {
        return;
      }
      atom.set({
        charging: battery.charging,
        level: battery.level,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime,
      });
    };

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
        battery.removeEventListener("chargingchange", emit);
      } catch {
        // ignore
      }
      try {
        battery.removeEventListener("levelchange", emit);
      } catch {
        // ignore
      }
      try {
        battery.removeEventListener("chargingtimechange", emit);
      } catch {
        // ignore
      }
      try {
        battery.removeEventListener("dischargingtimechange", emit);
      } catch {
        // ignore
      }
      atom.dispose();
    };

    if (signal) {
      signal.addEventListener("abort", cleanup, { once: true });
    }

    battery.addEventListener("chargingchange", emit);
    battery.addEventListener("levelchange", emit);
    battery.addEventListener("chargingtimechange", emit);
    battery.addEventListener("dischargingtimechange", emit);

    // Emit initial snapshot
    emit();

    try {
      yield* { [Symbol.asyncIterator]: () => iterate(atom, signal) };
    } finally {
      cleanup();
    }
  });
}
