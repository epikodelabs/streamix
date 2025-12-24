import { createAsyncGenerator, createSubject, type Receiver, type Stream } from "@epikode/streamix";

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
 * @returns {Stream<BatteryState>}
 */
export function onBattery(): Stream<BatteryState> {
  const subject = createSubject<BatteryState>();

  let subscriberCount = 0;
  let stopped = true;
  let battery: any = null;

  const snapshot = (): BatteryState => ({
    charging: battery.charging,
    level: battery.level,
    chargingTime: battery.chargingTime,
    dischargingTime: battery.dischargingTime
  });

  const emit = () => {
    subject.next(snapshot());
  };

  const start = async () => {
    if (!stopped) return;
    stopped = false;

    // SSR / unsupported API guard
    if (typeof navigator === "undefined" || !(navigator as any).getBattery) {
      return;
    }

    battery = await (navigator as any).getBattery();
    emit();

    battery.addEventListener("chargingchange", emit);
    battery.addEventListener("levelchange", emit);
    battery.addEventListener("chargingtimechange", emit);
    battery.addEventListener("dischargingtimechange", emit);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;

    if (!battery) return;

    battery.removeEventListener("chargingchange", emit);
    battery.removeEventListener("levelchange", emit);
    battery.removeEventListener("chargingtimechange", emit);
    battery.removeEventListener("dischargingtimechange", emit);

    battery = null;
  };

  /* ------------------------------------------------------------------------
   * Ref-counted subscription handling
   * ---------------------------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  subject.subscribe = (
    cb?: ((v: BatteryState) => void) | Receiver<BatteryState>
  ) => {
    const sub = originalSubscribe.call(subject, cb);

    if (++subscriberCount === 1) {
      void start();
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

  subject.name = "onBattery";
  return subject;
}

