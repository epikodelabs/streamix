import { atom, createAsyncIterator, type AtomBase, type Receiver } from "@epikodelabs/streamix";

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
export function onIdle(timeout?: number): AtomBase<IdleDeadline> {
  const atom$ = atom<IdleDeadline>();

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

      atom$.next(deadline);
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

  const originalSubscribe = atom$.subscribe;
  const scheduleStart = () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      startLoop();
    }
  };

  (atom$ as any).subscribe = (
    callback?: ((value: IdleDeadline) => void) | Receiver<IdleDeadline>
  ) => {
    const callbackFn = typeof callback === "function"
      ? callback
      : (value: IdleDeadline) => callback?.next?.(value);

    const sub = (originalSubscribe as any).call(atom$, callbackFn);

    scheduleStart();

    const o = sub.teardown;
    sub.teardown = () => {
      if (--subscriberCount === 0) {
        stopLoop();
      }
      o?.call(sub);
    };

    return sub;
  };

  (atom$ as any)[Symbol.asyncIterator] = () =>
    createAsyncIterator({ register: (receiver: Receiver<any>) => atom$.subscribe(receiver as any) })();

  (atom$ as any).name = "onIdle";
  (atom$ as any).type = "stream";
  return atom$ as AtomBase<IdleDeadline>;
}


