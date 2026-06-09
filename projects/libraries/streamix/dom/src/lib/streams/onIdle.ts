import { asyncAtom, createStream, iterate, type Stream } from "@epikodelabs/streamix";

/**
 * Creates a reactive stream that emits `IdleDeadline` objects whenever
 * the browser enters an idle period.
 *
 * **Behavior:**
 * - Schedules a shared idle loop on first subscription.
 * - Emits the `IdleDeadline` provided by `requestIdleCallback`.
 * - Falls back to `setTimeout` when `requestIdleCallback` is unavailable.
 * - Stops the loop when the signal is aborted (last subscriber unsubscribes).
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param timeout Optional timeout (ms) after which the idle callback must fire.
 * @returns {Stream<IdleDeadline>} A stream emitting idle deadlines.
 */
export function onIdle(timeout?: number): Stream<IdleDeadline> {
  return createStream<IdleDeadline>("onIdle", async function* (signal) {
    // SSR / non-browser guard
    if (typeof setTimeout !== "function") return;

    const atom = asyncAtom<IdleDeadline>();

    const ric: typeof requestIdleCallback =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback
        : ((cb: IdleRequestCallback) =>
            setTimeout(
              () =>
                cb({
                  didTimeout: false,
                  timeRemaining: () => 0,
                } as IdleDeadline),
              0
            )) as unknown as typeof requestIdleCallback;

    const cancel: (id: number) => void =
      typeof cancelIdleCallback === "function"
        ? cancelIdleCallback
        : clearTimeout;

    const options = timeout != null ? { timeout } : undefined;
    let idleId: number | null = null;

    const cleanup = () => {
      if (idleId !== null) {
        try {
          cancel(idleId);
        } catch {
          // ignore
        }
        idleId = null;
      }
      atom.dispose();
    };

    if (signal) {
      signal.addEventListener("abort", cleanup, { once: true });
    }

    const tick = (deadline: IdleDeadline) => {
      if (signal?.aborted) return;
      atom.set(deadline);
      idleId = ric(tick, options);
    };

    idleId = ric(tick, options);

    try {
      yield* { [Symbol.asyncIterator]: () => iterate(atom, signal) };
    } finally {
      cleanup();
    }
  });
}
