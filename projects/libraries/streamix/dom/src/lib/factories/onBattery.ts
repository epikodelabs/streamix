import { createSharedSource, type Atom } from "@epikodelabs/streamix";

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
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Atom<BatteryState>}
 */
export function onBattery(): Atom<BatteryState> {
  return createSharedSource<BatteryState>((push) => {
    let cleaned = false;
    let battery: any = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      if (!battery) return;

      battery.removeEventListener("chargingchange", emit);
      battery.removeEventListener("levelchange", emit);
      battery.removeEventListener("chargingtimechange", emit);
      battery.removeEventListener("dischargingtimechange", emit);

      battery = null;
    };

    const snapshot = (): BatteryState => ({
      charging: battery.charging,
      level: battery.level,
      chargingTime: battery.chargingTime,
      dischargingTime: battery.dischargingTime
    });

    const emit = async () => {
      if (cleaned) return;
      await push(snapshot());
    };

    // SSR / unsupported API guard
    if (typeof navigator === "undefined" || !(navigator as any).getBattery) {
      return cleanup;
    }

    void (async () => {
      try {
        battery = await (navigator as any).getBattery();
        if (cleaned) return;

        // Defer initial emission to allow subscription variable assignment
        void emit();

        battery.addEventListener("chargingchange", emit);
        battery.addEventListener("levelchange", emit);
        battery.addEventListener("chargingtimechange", emit);
        battery.addEventListener("dischargingtimechange", emit);
      } catch {
        // getBattery() rejected - silently fail (e.g., permission denied)
      }
    })();

    return cleanup;
  }, { name: "onBattery" });
}
