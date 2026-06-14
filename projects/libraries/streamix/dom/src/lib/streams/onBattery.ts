import { atom, createAsyncIterator, type AtomBase, type Receiver } from "@epikodelabs/streamix";

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
export function onBattery(): AtomBase<BatteryState> {
  const atom$ = atom<BatteryState>();

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
    atom$.next(snapshot());
  };

  const start = async () => {
    if (!stopped) return;
    stopped = false;

    // SSR / unsupported API guard
    if (typeof navigator === "undefined" || !(navigator as any).getBattery) {
      return;
    }

    try {
      battery = await (navigator as any).getBattery();
      if (stopped || subscriberCount === 0) return;
      
      // Defer initial emission to allow subscription variable assignment
      if (!stopped) emit();

      battery.addEventListener("chargingchange", emit);
      battery.addEventListener("levelchange", emit);
      battery.addEventListener("chargingtimechange", emit);
      battery.addEventListener("dischargingtimechange", emit);
    } catch (err) {
      // getBattery() rejected - silently fail (e.g., permission denied)
      stopped = true;
    }
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      start();
    }
  };

  (atom$ as any).subscribe = (
    callback?: ((value: BatteryState) => void) | Receiver<BatteryState>
  ) => {
    const callbackFn = typeof callback === "function"
      ? callback
      : (value: BatteryState) => callback?.next?.(value);

    const subscription = (originalSubscribe as any).call(atom$, callbackFn);

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
    createAsyncIterator({ register: (receiver: Receiver<any>) => atom$.subscribe(receiver as any) })();

  (atom$ as any).name = "onBattery";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<BatteryState>;
}


