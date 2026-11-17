import { createOperator, DONE, normalizeError, type Operator } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from "../factories";
import { createAsyncCoordinator } from "../utils";
import type { SourceCapabilities, SyncPoll } from "../utils/source-protocol";

/**
 * Buffers values from the source iterator until the notifier emits.
 * Once the notifier emits, the buffered values are flushed as an array.
 *
 * @template T Type of values emitted by the source iterator.
 * @template N Type of values emitted by the notifier stream (ignored).
 * @param {Stream<N>} notifier - Stream whose emissions trigger buffer flush.
 * @returns {Operator<T, T[]>} A streamix operator that collects values into arrays
 *   and emits them whenever the notifier emits or the source completes.
 */
export const bufferUntil = <T = any, N = any>(notifier: PipeInput<N>) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source: AsyncIterator<T>) {
    const notifierIt = from(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator<T | N>([
      source as AsyncIterator<T | N>,
      notifierIt as AsyncIterator<T | N>
    ]);

    // Buffered source values
    let buffer: T[] = [];

    // Whether the source has completed
    let sourceCompleted = false;

    // Whether the iterator has been cancelled (return/throw)
    let cancelled = false;

    /**
     * Flushes the current buffer.
     *
     * - Emits a copy of the buffered values.
     *
     * @returns {IteratorResult<T[]>} IteratorResult with flushed values or DONE.
     */
    const flushBuffer = (): IteratorResult<T[]> => {
      if (buffer.length === 0) return DONE;

      const values = [...buffer];
      buffer = [];
      return { value: values, done: false };
    };

    const close = () => {
      if (cancelled) return;
      cancelled = true;
      runner.return?.().catch(() => {});
    };

    const closeAsync = async () => {
      if (cancelled) return;
      cancelled = true;
      try {
        await runner.return?.();
      } catch {}
    };

    /**
     * The AsyncIterator returned by the operator.
     *
     * Supports the standard AsyncIterator protocol:
     * - `next()`
     * - `return()`
     * - `throw()`
     *
     * And the internal source protocol capabilities for streamix internals:
     * - `pollSync()` — synchronous poll for testing and internal operators.
     * - `hasBufferedEvents()` — checks if buffer or runner holds pending values.
     * - `isTerminal()` — checks if the source completed or the operator closed.
     */
    const iterator: AsyncIterator<T[]> & SourceCapabilities<T[]> = {
      /**
       * Pulls the next buffered array of values.
       *
       * - Buffers source values.
       * - Flushes buffer on notifier emission.
       * - Flushes buffer when source completes.
       *
       * @returns {Promise<IteratorResult<T[]>>} Next buffered array or DONE.
       */
      async next() {
        while (true) {
          if (cancelled) return DONE;

          if (sourceCompleted && buffer.length === 0) {
            return DONE;
          }

          const runnerResult = await runner.next();

          if (runnerResult.done) {
            // Flush any remaining buffered values when runner completes
            sourceCompleted = true;
            return flushBuffer();
          }

          const event = runnerResult.value;

          switch (event.type) {
            case "value":
              if (event.sourceIndex === 0) {
                // Source value: buffer it
                buffer.push(event.value as T);
              } else {
                // Notifier value: flush buffer
                if (buffer.length > 0) return flushBuffer();
              }
              break;

            case "complete":
              // Source completed: flush buffer if any, then finish
              if (event.sourceIndex === 0) {
                sourceCompleted = true;
                await closeAsync();
                if (buffer.length > 0) return flushBuffer();
                return DONE;
              }
              break;

            case "error":
              buffer = [];
              await closeAsync();
              throw normalizeError(event.error);
          }
        }
      },

      /**
       * Cancels the iterator and flushes/cleans upstream sources.
       *
       * @param value Optional value to return
       * @returns {Promise<IteratorResult<T[]>>} DONE or returned value
       */
      async return(value?: any) {
        if (cancelled) return value !== undefined ? { value, done: true } : DONE;
        buffer = [];
        await closeAsync();
        return value !== undefined ? { value, done: true } : DONE;
      },

      /**
       * Throws an error into the iterator and cancels upstream sources.
       *
       * @param err Error to propagate
       * @returns {Promise<never>} Rejected promise with the error
       */
      async throw(err?: any) {
        const error = normalizeError(err);
        if (cancelled) return Promise.reject(error);
        buffer = [];
        await closeAsync();
        return Promise.reject(error);
      },

      /**
       * Internal synchronous poll (used by streamix for tests/operators).
       *
       * @returns {SyncPoll<T[]>} The next buffered array, the terminal
       *   completion, or `unavailable` when nothing can be produced sync.
       */
      pollSync(): SyncPoll<T[]> {
        if (cancelled) return { status: "available", result: DONE };
        if (sourceCompleted && buffer.length === 0) return { status: "available", result: DONE };

        while (true) {
          const runnerPoll = runner.pollSync();
          if (runnerPoll.status === 'unavailable') return { status: "unavailable" };

          const runnerResult = runnerPoll.result;

          if (runnerResult.done) {
            sourceCompleted = true;
            return { status: "available", result: flushBuffer() };
          }

          const event = runnerResult.value;

          switch (event.type) {
            case "value":
              if (event.sourceIndex === 0) {
                buffer.push(event.value as T);
              } else if (buffer.length > 0) {
                return { status: "available", result: flushBuffer() };
              }
              break;

            case "complete":
              if (event.sourceIndex === 0) {
                sourceCompleted = true;
                close();
                if (buffer.length > 0) return { status: "available", result: flushBuffer() };
                return { status: "available", result: DONE };
              }
              break;

            case "error":
              buffer = [];
              close();
              throw normalizeError(event.error);
          }
        }
      },

      /**
       * Checks whether the operator or its runner holds unconsumed events.
       *
       * @returns {boolean} True if buffer or runner has pending values
       */
      hasBufferedEvents: () =>
        buffer.length > 0 ||
        (runner.hasBufferedEvents?.() ?? false),

      isTerminal: () => cancelled || sourceCompleted,
    };

    return iterator;
  });
