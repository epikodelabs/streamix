import type { Readable } from "./atom";
import { ANALOG_DELIVERY, getProducerCompletion } from "./delivery";
import { DONE, NEXT, type MaybePromise } from "./operator";
import { REPLAY_ITERATOR } from './replay';
import type { Subscription } from "./subscription";
import { createSourceReadiness, type SourceCapabilities, type SyncPoll } from "../utils/source-protocol";

interface PendingPull<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
  next?: PendingPull<T>;
}

export interface IterateOptions {
  /**
   * Whether a Readable's current value should be delivered when iteration starts.
   * Defaults to true. Internal adapters can disable this when they already
   * captured the same current value and only need future emissions.
   */
  replayCurrent?: boolean;
}

/**
 * Creates an async iterable from an atom.
 *
 * Yields the current value immediately, then yields subsequent values
 * whenever the atom emits. Producer completion and atom disposal end
 * iteration after buffered values drain.
 * Concurrent next() calls receive values in call order. If the source fails,
 * buffered values drain before the error, and all waiting reads reject.
 * Explicit return() discards buffered values and ends all waiting reads.
 *
 * @param source - The atom or async iterable to iterate over.
 * @returns An async iterable iterator that yields source values.
 *
 * @example
 * ```ts
 * const a = atom(0);
 * setTimeout(() => a.next(1), 10);
 * setTimeout(() => a.next(2), 20);
 * setTimeout(() => a.dispose(), 30);
 *
 * for await (const value of iterate(a)) {
 *   console.log(value); // 0, 1, 2
 * }
 * ```
 */
export function iterate<T>(
  source: Readable<T> | AsyncIterable<T>,
  options?: IterateOptions,
): AsyncIterableIterator<T> {
  if (!("type" in source) || (source as any).type !== "atom") {
    return source as AsyncIterableIterator<T>;
  }

  const atom = source as Readable<T>;
  const replay = (atom as any)[REPLAY_ITERATOR]?.();
  if (replay) return replay;
  const conflate = (atom as any)[ANALOG_DELIVERY] === true;

  const completion = getProducerCompletion(atom);
  let initialized = false;
  let initializing = false;
  let finished = false;
  let stopCompletion: (() => void) | undefined;
  let stopDisposal: (() => void) | undefined;
  const sourceEnded = () => done || finished || atom.disposed || completion?.completed === true;
  const buffer: T[] = [];
  let pendingHead: PendingPull<T> | undefined;
  let pendingTail: PendingPull<T> | undefined;
  let terminalError: Error | undefined;
  let done = false;
  const readiness = createSourceReadiness();
  let finish: (() => MaybePromise<void>) | undefined;
  let errorUnsubscribe: Subscription | undefined;

  const settlePending = (settle: (pull: PendingPull<T>) => void) => {
    let pull = pendingHead;
    pendingHead = pendingTail = undefined;
    while (pull) {
      settle(pull);
      pull = pull.next;
    }
  };

  const notifyPush = () => {
    if (!initializing) readiness.notify();
  };

  const subscribeToSource = () => {
    let subscribing = true;
    const unsubscribe = atom.subscribe((value) => {
      if (done || finished) return;
      if (options?.replayCurrent === false && subscribing) return;
      if (pendingHead) {
        const pull = pendingHead;
        pendingHead = pull.next;
        if (!pendingHead) pendingTail = undefined;
        pull.resolve(NEXT(value));
      } else if (conflate && buffer.length > 0) {
        buffer[0] = value;
      } else {
        buffer.push(value);
      }
      // Initial replay happens inside subscribe(), before error and disposal
      // handlers are installed. Let the initiating read receive that replay;
      // reentering pollSync here would observe a partially initialized iterator.
      if (!subscribing) notifyPush();
    });
    subscribing = false;

    finish = () => {
      if (finished) return;
      finished = true;
      if (!done) {
        const error = atom.error;
        if (pendingHead) {
          done = true;
          settlePending(error ? pull => pull.reject(error) : pull => pull.resolve(DONE));
        } else {
          terminalError = error;
          done = buffer.length === 0 && !error;
        }
      }
      // Remove ourselves from the atom's dispose handlers: iteration can end
      // (return()/error) long before the atom is disposed, and every finished
      // iterator left here would otherwise leak until the atom's disposal.
      stopDisposal?.();
      stopDisposal = undefined;
      stopCompletion?.();
      stopCompletion = undefined;
      errorUnsubscribe?.();
      errorUnsubscribe = undefined;
      const cleanup = unsubscribe();
      notifyPush();
      return cleanup;
    };

    if (done) {
      finish();
      return;
    }
    stopDisposal = completion?.onDispose?.(() => { finish?.(); });
    errorUnsubscribe = atom.onError(() => {
      if (!done) finish?.();
    });
    if (finished) {
      errorUnsubscribe?.();
      errorUnsubscribe = undefined;
    } else {
      stopCompletion = completion?.onComplete(() => { finish?.(); });
      if (finished) { stopCompletion?.(); stopCompletion = undefined; }
    }
    if (atom.disposed && !finished) finish();
  };

  const ensureInit = () => {
    if (initialized) return;
    initialized = true;
    initializing = true;
    try {
      subscribeToSource();
    } catch (error) {
      done = true;
      buffer.length = 0;
      settlePending(pull => pull.reject(error));
      finish?.();
      throw error;
    } finally {
      initializing = false;
    }
  };

  const poll = (): SyncPoll<T> => {
    if (done) return { status: "available", result: DONE };
    ensureInit();
    if (done) return { status: "available", result: DONE };
    if (initializing) return { status: "unavailable" };

    // Values already accepted from the source precede a terminal error.
    if (buffer.length > 0) {
      return { status: "available", result: NEXT(buffer.shift()!) };
    }
    if (terminalError) {
      const error = terminalError;
      terminalError = undefined;
      done = true;
      throw error;
    }
    if (sourceEnded()) {
      done = true;
      return { status: "available", result: DONE };
    }
    return { status: "unavailable" };
  };

  const iterator: AsyncIterableIterator<T> & SourceCapabilities<T> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (initialized || done) {
        const polled = poll();
        if (polled.status === "available") return polled.result;
      }

      return new Promise<IteratorResult<T>>((resolve, reject) => {
        // Reserve the first pull before subscribing, since producer startup
        // can reenter next() before the subscription returns.
        const pull: PendingPull<T> = { resolve, reject };
        if (pendingTail) pendingTail.next = pull;
        else pendingHead = pull;
        pendingTail = pull;
        ensureInit();
      });
    },
    async return() {
      const wasDone = done;
      done = true;
      buffer.length = 0;
      terminalError = undefined;
      settlePending(pull => pull.resolve(DONE));
      if (finish) await finish();
      else if (!wasDone) notifyPush();
      return DONE;
    },
    pollSync: poll,

    // Held values only — terminal completion is reported by `isTerminal`.
    hasBufferedEvents(): boolean {
      return !done && (buffer.length > 0 || terminalError !== undefined || (!initialized && atom.error !== undefined));
    },

    isTerminal(): boolean {
      return sourceEnded();
    },

    onReady: readiness.onReady,
  };

  return iterator;
}
