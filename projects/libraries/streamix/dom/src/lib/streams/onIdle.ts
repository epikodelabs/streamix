import { createAsyncIterator, createSubject, type Receiver, type Stream } from "@epikodelabs/streamix";

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
 * @returns {Stream<IdleDeadline>} A stream emitting idle deadlines.
 */
export function onIdle(timeout?: number): Stream<IdleDeadline> {
  const subject = createSubject<IdleDeadline>();

  let subscriberCount = 0;
  let stopped = true;
  let idleId: number | null = null;

  const startLoop = () => {
    if (!stopped) return;
    stopped = false;

    // SSR / non-browser guard
    if (typeof setTimeout !== "function") return;

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

    const tick = (deadline: IdleDeadline) => {
      if (stopped) return;

      subject.next(deadline);
      idleId = ric(tick, timeout != null ? { timeout } : undefined);
    };

    idleId = ric(tick, timeout != null ? { timeout } : undefined);
  };

  const stopLoop = () => {
    if (stopped) return;
    stopped = true;

    if (idleId !== null) {
      if (typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId);
      }
      idleId = null;
    }
  };

  /* ------------------------------------------------------------------------
   * Ref-counted subscription handling
   * ---------------------------------------------------------------------- */

  const originalSubscribe = subject.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      startLoop();
    }
  };

  subject.subscribe = (
    callback?: ((value: IdleDeadline) => void) | Receiver<IdleDeadline>
  ) => {
    const subscription = originalSubscribe.call(subject, callback);

    scheduleStart();

    const originalOnUnsubscribe = subscription.onUnsubscribe;
    subscription.onUnsubscribe = () => {
      if (--subscriberCount === 0) {
        stopLoop();
      }
      originalOnUnsubscribe?.call(subscription);
    };

    return subscription;
  };

  /* ------------------------------------------------------------------------
   * Async iteration support
   * ---------------------------------------------------------------------- */

  subject[Symbol.asyncIterator] = () =>
    createAsyncIterator({ register: (receiver: Receiver<any>) => subject.subscribe(receiver) })();

  subject.name = "onIdle";
  return subject;
}


