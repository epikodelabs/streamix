import { createOperator, DONE, type Operator } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from "../factories";
import { createAsyncCoordinator } from "../utils";
import { normalizeError } from "../utils/helpers";

/**
 * Buffers values from the source iterator until the notifier emits.
 * Once the notifier emits, the buffered values are flushed as an array.
 *
 * @template T Type of values emitted by the source iterator.
 * @template N Type of values emitted by the notifier stream (ignored).
 * @param {Stream<N>} notifier - Stream whose emissions trigger buffer flush.
 * @returns {Operator<T, T[]>} A Streamix operator that collects values into arrays
 *   and emits them whenever the notifier emits or the source completes.
 */
export const bufferUntil = <T = any, N = any>(notifier: PipeInput<N>) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source: AsyncIterator<T>) {
    const notifierIt = from(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator([source, notifierIt]);

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

    const finish = async () => {
      if (cancelled || sourceCompleted) return;
      sourceCompleted = true;
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
     * And two internal helpers for Streamix internals:
     * - `__tryNext()` — synchronous try-pull for testing and internal operators.
     * - `__hasBufferedValues()` — checks if buffer or runner has pending values.
     */
    const iterator: AsyncIterator<T[]> & {
      __tryNext?: () => IteratorResult<T[]> | null;
      __hasBufferedValues?: () => boolean;
    } = {
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
                if (buffer.length > 0) return flushBuffer();
                await finish();
                return DONE;
              }
              break;

            case "error":
              // Propagate error and cancel iterator
              cancelled = true;
              try {
                await runner.return?.();
              } catch {}
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
        cancelled = true;
        try {
          await runner.return?.();
        } catch {}
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
        cancelled = true;
        try {
          await runner.throw?.(error);
        } catch {}
        return Promise.reject(error);
      },

      /**
       * Internal synchronous try-pull (used by Streamix for tests/operators).
       *
       * @returns {IteratorResult<T[]> | null} Next buffered array or null if no sync value
       */
      __tryNext: () => {
        if (cancelled) return DONE;
        if (sourceCompleted && buffer.length === 0) return DONE;
        if (!runner.__tryNext) return null;

        while (true) {
          const runnerResult = runner.__tryNext();
          if (!runnerResult) return null;

          if (runnerResult.done) return flushBuffer();

          const event = runnerResult.value;

          switch (event.type) {
            case "value":
              if (event.sourceIndex === 0) {
                buffer.push(event.value as T);
              } else if (buffer.length > 0) {
                return flushBuffer();
              }
              break;

            case "complete":
              if (event.sourceIndex === 0) {
                sourceCompleted = true;
                if (buffer.length > 0) return flushBuffer();
                runner.return?.().catch(() => {});
                return DONE;
              }
              break;

            case "error":
              cancelled = true;
              runner.return?.().catch(() => {});
              throw normalizeError(event.error);
          }
        }
      },

      /**
       * Checks whether the operator has buffered values (including runner pending items)
       *
       * @returns {boolean} True if buffer or runner has pending values
       */
      __hasBufferedValues: () => buffer.length > 0 || (runner.__hasBufferedValues ? runner.__hasBufferedValues() : false),
    };

    return iterator;
  });
