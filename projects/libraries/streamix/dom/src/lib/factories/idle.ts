import { createSharedSource, type Atom } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits `IdleDeadline` objects whenever
 * the browser enters an idle period.
 *
 * This stream is useful for scheduling low-priority work such as:
 * - background computations
 * - prefetching
 * - cache warming
 * - non-urgent state updates
 *
 * **Behavior:**
 * - Starts a shared idle loop when the first subscriber subscribes.
 * - Emits the `IdleDeadline` object provided by `requestIdleCallback`.
 * - Continues scheduling idle callbacks until all subscribers unsubscribe.
 * - Falls back to `setTimeout` when `requestIdleCallback` is unavailable.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param timeout Optional timeout (ms) after which idle callback must fire.
 * @returns {Atom<IdleDeadline>} An atom emitting idle deadlines.
 */
export function idle(timeout?: number): Atom<IdleDeadline> {
  return createSharedSource<IdleDeadline>((push) => {
    let cleaned = false;
    let idleId: number | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (idleId !== null) {
        if (typeof cancelIdleCallback === "function") {
          cancelIdleCallback(idleId);
        } else {
          clearTimeout(idleId);
        }
        idleId = null;
      }
    };

    // SSR / non-browser guard
    if (typeof setTimeout !== "function") {
      return cleanup;
    }

    const ric: typeof requestIdleCallback =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : ((cb: IdleRequestCallback) =>
            setTimeout(
              () =>
                cb({
                  didTimeout: false,
                  timeRemaining: () => 0
                } as IdleDeadline),
              0
            )) as unknown as typeof requestIdleCallback;

    const emit = async (value: IdleDeadline) => {
      if (cleaned) return;
      await push(value);
    };

    const tick = async (deadline: IdleDeadline) => {
      if (cleaned) return;
      await emit(deadline);
      if (cleaned) return;
      idleId = ric(tick, timeout != null ? { timeout } : undefined);
    };

    idleId = ric(tick, timeout != null ? { timeout } : undefined);

    return cleanup;
  }, { name: "idle" });
}
