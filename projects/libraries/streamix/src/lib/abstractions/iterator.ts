import {
  getIteratorEmissionStamp,
  nextEmissionStamp,
  setIteratorEmissionStamp
} from "./emission";

import { DONE } from "./operator";

import { getCurrentEmissionStamp } from "./emission";
import { IteratorMetaKind, setIteratorMeta, setValueMeta } from "./hooks";
import { isPromiseLike } from "./operator";
import type { Receiver, StrictReceiver } from "./receiver";
import type { Subscription } from "./subscription";

/**
 * Attaches tracing metadata to both an iterator and a value in a single call.
 *
 * Consolidates the common `setIteratorMeta` + `setValueMeta` pattern.
 * Returns the (possibly wrapped) value.
 *
 * @param iterator The async iterator to tag.
 * @param value The value to tag.
 * @param meta Metadata from `getIteratorMeta(source)`. If `undefined`, the value is returned unchanged.
 * @param tag Optional additional tag fields (kind, inputValueIds).
 */
export function tagValue<T>(
  iterator: AsyncIterator<any>,
  value: T,
  meta: { valueId: string; operatorIndex: number; operatorName: string } | undefined,
  tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }
): T {
  if (!meta) return value;
  const metaTag = { valueId: meta.valueId, ...tag };
  setIteratorMeta(iterator, metaTag, meta.operatorIndex, meta.operatorName);
  return setValueMeta(value, metaTag, meta.operatorIndex, meta.operatorName);
}

/**
 * Creates a factory that produces fresh `AsyncIterator` instances backed by
 * an internal queue with producer-backpressure.
 *
 * The `register` callback receives a `Receiver<T>` whose `next()`/`complete()`/
 * `error()` methods push into the iterator's queue. `next()` returns a
 * `Promise<void>` (or `void`) – the promise acts as a backpressure signal
 * from the consumer: it resolves only when the consumer pulls the value with
 * `next()` or `__tryNext()`.
 *
 * Each call of the returned factory function creates an independent iterator
 * with its own buffer and subscription.
 *
 * When `lazy: true`, registration is deferred until the consumer actually pulls
 * (either `next()` or `__tryNext>`), which avoids hidden subscriptions for
 * iterators that are constructed but never consumed.
 *
 * @template T Value type.
 * @param opts Registration function and lazy mode.
 * @returns A function that creates a fresh AsyncIterator per call.
 */
export function createAsyncIterator<T>(opts: {
  register: (receiver: Receiver<T>) => Subscription;
  /**
   * When `true`, the iterator does not register with the source until the
   * consumer actually pulls (`next()`/`__tryNext()`).
   *
   * Streams should generally use `lazy: true` to avoid creating hidden
   * subscriptions when an iterator is constructed but never consumed.
   *
   * Subjects should generally use `lazy: false` so operators that eagerly
   * emit into an internal Subject can buffer values for downstream consumers.
   */
  lazy?: boolean;
}) {
  const { register, lazy = false } = opts;

  // IMPORTANT: return a *fresh* iterator per call. The old implementation
  // registered a receiver eagerly during subject creation, which could
  // deadlock subjects by introducing backpressure even when nobody is iterating.
  return () => {
    let pullResolve: ((v: IteratorResult<T>) => void) | null = null;
    let pullReject: ((e: any) => void) | null = null;
    const queue: Array<{ result: IteratorResult<T>; stamp: number }> = [];
    const backpressureQueue: Array<() => void> = [];
    let pendingError: { err: any; stamp: number } | null = null;
    let completed = false;
    let sub: Subscription | null = null;

    let iteratorReceiver!: StrictReceiver<T>;

    const ensureSubscribed = () => {
      if (completed) return;
      if (!sub) sub = register(iteratorReceiver);
    };

    const iterator: AsyncIterator<T> & {
      // Non-standard helpers used by internal Stream piping/tests.
      __tryNext?: () => IteratorResult<T> | null;
      __hasBufferedValues?: () => boolean;
      // Internal hook: some operators (e.g. switchMap) may attach this to
      // synchronously drain buffered values when a producer pushes while the
      // consumer is not currently awaiting `next()`.
      __onPush?: () => void;
    } = {
      next() {
        ensureSubscribed();

        // Drain buffered values before checking pending errors so that
        // values pushed before an error are delivered first.
        if (queue.length > 0) {
          const { result, stamp } = queue.shift()!;
          setIteratorEmissionStamp(iterator, stamp);
          // Resolves the backpressure promise returned by receiver.next().
          backpressureQueue.shift()?.();
          if (result.done) {
            const unsubscribePromise = sub?.unsubscribe();
            sub = null;
            if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
              unsubscribePromise.catch(() => {});
            }
          }
          return Promise.resolve(result);
        }

        if (pendingError) {
          const { err, stamp } = pendingError;
          pendingError = null;
          setIteratorEmissionStamp(iterator, stamp);
          return Promise.reject(err);
        }

        if (completed) {
          const unsubscribePromise = sub?.unsubscribe();
          sub = null;
          // Ensure teardown has a chance to run, but don't block iteration.
          if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
            unsubscribePromise.catch(() => {});
          }
          return Promise.resolve(DONE);
        }

        return new Promise((res, rej) => {
          pullResolve = res;
          pullReject = rej;
        });
      },

      async return() {
        completed = true;
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          r(DONE);
        }

        // Release any pending producer backpressure.
        for (const resolve of backpressureQueue) resolve();
        backpressureQueue.length = 0;

        try {
          await unsubscribePromise;
        } catch {
        }
        return Promise.resolve(DONE);
      },

      async throw(err) {
        completed = true;
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;

        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          r(err);
        }

        for (const resolve of backpressureQueue) resolve();
        backpressureQueue.length = 0;

        try {
          await unsubscribePromise;
        } catch {
        }
        return Promise.reject(err);
      }
    };

    iterator.__hasBufferedValues = () =>
      queue.length > 0 || pendingError != null || completed;

    iterator.__tryNext = () => {
      ensureSubscribed();

      // Drain buffered values before checking pending errors so that
      // values pushed before an error are delivered first.
      if (queue.length > 0) {
        const { result, stamp } = queue.shift()!;
        setIteratorEmissionStamp(iterator, stamp);
        backpressureQueue.shift()?.();
        if (result.done) {
          const unsubscribePromise = sub?.unsubscribe();
          sub = null;
          if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
            unsubscribePromise.catch(() => {});
          }
        }
        return result;
      }

      if (pendingError) {
        const { err, stamp } = pendingError;
        pendingError = null;
        setIteratorEmissionStamp(iterator, stamp);
        throw err;
      }

      if (completed) {
        const unsubscribePromise = sub?.unsubscribe();
        sub = null;
        if (unsubscribePromise && isPromiseLike(unsubscribePromise)) {
          unsubscribePromise.catch(() => {});
        }
        return DONE;
      }

      return null;
    };

    const _iteratorReceiver: StrictReceiver<T> = {
      next(value: T) {
        if (completed) return;
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();
        const result: IteratorResult<T> = { done: false, value };

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          setIteratorEmissionStamp(iterator, stamp);
          r(result);
          iterator.__onPush?.();
          return;
        }

        queue.push({ result, stamp });
        // Give consumers a chance to drain synchronously from the buffer.
        if (typeof iterator.__onPush === "function") {
          iterator.__onPush();
          return;
        }

        // Producer backpressure: block the producer until the consumer pulls.
        return new Promise<void>((resolve) => backpressureQueue.push(resolve));
      },

      complete() {
        if (completed) return;
        completed = true;
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

        if (pullResolve) {
          const r = pullResolve;
          pullResolve = pullReject = null;
          setIteratorEmissionStamp(iterator, stamp);
          r(DONE);
          return;
        }

        queue.push({ result: DONE, stamp });
        iterator.__onPush?.();
      },

      error(err) {
        if (completed) return;
        completed = true;
        const stamp = getCurrentEmissionStamp() ?? nextEmissionStamp();

        if (pullReject) {
          const r = pullReject;
          pullResolve = pullReject = null;
          setIteratorEmissionStamp(iterator, stamp);
          r(err);
          return;
        }

        pendingError = { err, stamp };
        iterator.__onPush?.();
      },

      get completed() {
        return completed;
      }
    };

    iteratorReceiver = _iteratorReceiver;

    // Subjects rely on buffering: many operators push into an internal Subject
    // immediately during `apply()`, before the downstream consumer starts
    // awaiting `next()`. Eager registration ensures those pushes are buffered.
    if (!lazy) {
      ensureSubscribed();
    }

    return iterator;
  };
}

type RunnerEvent<T> =
  | { type: "value"; value: T; sourceIndex: number }
  | { type: "complete"; sourceIndex: number }
  | { type: "error"; error: any; sourceIndex: number };

function insertOrdered(arr: { stamp: number }[], item: any) {
  let i = arr.length;
  while (i > 0 && arr[i - 1].stamp > item.stamp) i--;
  arr.splice(i, 0, item);
}

export function createMultiSourceRunner(
  sources: AsyncIterator<any>[]
): AsyncIterator<RunnerEvent<any>> & {
  __tryNext?: () => IteratorResult<RunnerEvent<any>> | null;
  __hasBufferedValues?: () => boolean;
} {
  type QueueItem = {
    result: IteratorResult<RunnerEvent<any>>;
    stamp: number;
  };

  const queue: QueueItem[] = [];
  const completed = new Array(sources.length).fill(false);
  const pulling = new Array(sources.length).fill(false);

  let waitingResolve: ((v: any) => void) | null = null;

  const allDone = () => completed.every(Boolean);

  function pushEvent(
    event: RunnerEvent<any>,
    stamp: number
  ) {
    insertOrdered(queue, {
      result: { done: false, value: event },
      stamp
    });
  }

  function notify() {
    if (!waitingResolve) return;

    if (queue.length > 0) {
      const item = queue.shift()!;
      const res = waitingResolve;
      waitingResolve = null;
      setIteratorEmissionStamp(iterator, item.stamp);
      res(item.result);
      return;
    }

    if (allDone()) {
      const res = waitingResolve;
      waitingResolve = null;
      res(DONE);
    }
  }

  function pullAsync(i: number) {
    if (completed[i] || pulling[i]) return;

    pulling[i] = true;
    const src: any = sources[i];

    let sync = true;
    const p = src.next();

    p.then(
      (r: IteratorResult<any>) => {
        pulling[i] = false;

        const stamp =
          getIteratorEmissionStamp(src) ??
          nextEmissionStamp();

        if (r.done) {
          completed[i] = true;
          pushEvent(
            { type: "complete", sourceIndex: i },
            stamp
          );
        } else {
          pushEvent(
            { type: "value", value: r.value, sourceIndex: i },
            stamp
          );
        }

        if (waitingResolve) notify();
        else if (!sync) scheduleDrain();
      },
      (err: any) => {
        pulling[i] = false;
        completed[i] = true;

        const stamp =
          getIteratorEmissionStamp(src) ??
          nextEmissionStamp();

        pushEvent(
          { type: "error", error: err, sourceIndex: i },
          stamp
        );

        notify();
      }
    );

    sync = false;
  }

  function drainSources() {
    for (let i = 0; i < sources.length; i++) {
      if (completed[i]) continue;

      const src: any = sources[i];

      // sync source
      if (src.__tryNext) {
        try {
          const r = src.__tryNext();
          if (!r) continue;

          const stamp =
            getIteratorEmissionStamp(src) ??
            nextEmissionStamp();

          if (r.done) {
            completed[i] = true;
            pushEvent(
              { type: "complete", sourceIndex: i },
              stamp
            );
          } else {
            pushEvent(
              { type: "value", value: r.value, sourceIndex: i },
              stamp
            );
          }
        } catch (err) {
          completed[i] = true;
          const stamp =
            getIteratorEmissionStamp(src) ??
            nextEmissionStamp();

          pushEvent(
            { type: "error", error: err, sourceIndex: i },
            stamp
          );
        }
      }
      else {
        pullAsync(i);
      }
    }

    notify();
  }

  let drainScheduled = false;
  function scheduleDrain() {
    if (drainScheduled) return;
    drainScheduled = true;
    Promise.resolve().then(() => {
      drainScheduled = false;
      drainSources();
    });
  }

  // push notification hook
  for (const src of sources as any[]) {
    const orig = src.__onPush;
    src.__onPush = () => {
      orig?.();
      scheduleDrain();
    };
  }

  const iterator: any = {
    next() {
      drainSources();

      if (queue.length > 0) {
        const item = queue.shift()!;
        setIteratorEmissionStamp(iterator, item.stamp);
        return Promise.resolve(item.result);
      }

      if (allDone()) return Promise.resolve(DONE);

      return new Promise((res) => {
        waitingResolve = res;
      });
    },

    __tryNext() {
      drainSources();

      if (queue.length > 0) {
        const item = queue.shift()!;
        setIteratorEmissionStamp(iterator, item.stamp);
        return item.result;
      }

      return allDone() ? DONE : null;
    },

    __hasBufferedValues() {
      return queue.length > 0 || allDone();
    },

    async return() {
      completed.fill(true);

      const safe = (s: any) => {
        if (!s?.return) return Promise.resolve();
        try {
          return Promise.resolve(s.return()).catch(() => {});
        } catch {
          return Promise.resolve();
        }
      };

      await Promise.all(sources.map(safe));
      return DONE;
    }
  };

  return iterator;
}


