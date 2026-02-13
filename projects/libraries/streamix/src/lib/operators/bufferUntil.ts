import {
  createOperator,
  DONE,
  getIteratorEmissionStamp,
  getIteratorMeta,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  setIteratorMeta,
  setValueMeta,
  type Operator,
  type Stream,
} from "../abstractions";
import { fromAny } from "../converters";
import { createAsyncCoordinator } from "../utils";

/**
 * Buffers values from the source iterator until the notifier emits.
 * Once the notifier emits, the buffered values are flushed as an array.
 *
 * Preserves metadata (`valueId`, `operatorIndex`, `operatorName`) from
 * upstream iterators and attaches collapse metadata to the emitted array.
 *
 * @template T Type of values emitted by the source iterator.
 * @param {Stream<any>} notifier - Stream whose emissions trigger buffer flush.
 * @returns {Operator<T, T[]>} A Streamix operator that collects values into arrays
 *   and emits them whenever the notifier emits or the source completes.
 */
export const bufferUntil = <T = any>(notifier: Stream<any>) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source: AsyncIterator<T>) {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
    const runner = createAsyncCoordinator([source, notifierIt]);

    // Buffered source values
    let buffer: T[] = [];

    // Corresponding metadata for buffered values
    let bufferMetas: Array<{
      valueId: string;
      operatorIndex: number;
      operatorName: string;
      stamp: number;
    }> = [];

    // Whether the iterator has been cancelled (return/throw)
    let cancelled = false;

    /**
     * Flushes the current buffer.
     *
     * - Emits a copy of the buffered values.
     * - Attaches collapse metadata if upstream values have metadata.
     * - Updates iterator emission stamp.
     *
     * @returns {IteratorResult<T[]>} IteratorResult with flushed values or DONE.
     */
    const flushBuffer = (): IteratorResult<T[]> => {
      if (buffer.length === 0) return DONE;

      const values = [...buffer];
      const metas = [...bufferMetas];
      buffer = [];
      bufferMetas = [];

      if (metas.length > 0) {
        const lastMeta = metas[metas.length - 1];
        const collapseMeta = {
          valueId: lastMeta.valueId,
          kind: "collapse" as const,
          inputValueIds: metas.map(m => m.valueId),
        };

        // Attach metadata to iterator and values
        setIteratorMeta(iterator as any, collapseMeta, lastMeta.operatorIndex, lastMeta.operatorName);
        const taggedValues = setValueMeta(values, collapseMeta, lastMeta.operatorIndex, lastMeta.operatorName);

        // Set iterator emission stamp to last buffered item
        setIteratorEmissionStamp(iterator as any, lastMeta.stamp);

        return { value: taggedValues, done: false };
      } else {
        const lastStamp = getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp();
        setIteratorEmissionStamp(iterator as any, lastStamp);
        return { value: values, done: false };
      }
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

                // Capture metadata if available
                const meta = getIteratorMeta(runner as any);
                if (meta) {
                  bufferMetas.push({
                    valueId: meta.valueId,
                    operatorIndex: meta.operatorIndex,
                    operatorName: meta.operatorName,
                    stamp: getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp(),
                  });
                }
              } else {
                // Notifier value: flush buffer
                if (buffer.length > 0) return flushBuffer();
              }
              break;

            case "complete":
              // Source completed: flush buffer if any
              if (event.sourceIndex === 0 && buffer.length > 0) return flushBuffer();
              break;

            case "error":
              // Propagate error and cancel iterator
              cancelled = true;
              try {
                await notifierIt.return?.();
              } catch {}
              throw event.error;
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
          await notifierIt.return?.();
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
        if (cancelled) return Promise.reject(err);
        cancelled = true;
        try {
          await runner.throw?.(err).catch(() => {});
          await notifierIt.return?.();
        } catch {}
        return Promise.reject(err);
      },

      /**
       * Internal synchronous try-pull (used by Streamix for tests/operators).
       *
       * @returns {IteratorResult<T[]> | null} Next buffered array or null if no sync value
       */
      __tryNext: () => {
        if (cancelled) return DONE;
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
                const meta = getIteratorMeta(runner as any);
                if (meta) {
                  bufferMetas.push({
                    valueId: meta.valueId,
                    operatorIndex: meta.operatorIndex,
                    operatorName: meta.operatorName,
                    stamp: getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp(),
                  });
                }
              } else if (buffer.length > 0) {
                return flushBuffer();
              }
              break;

            case "complete":
              if (event.sourceIndex === 0 && buffer.length > 0) return flushBuffer();
              break;

            case "error":
              cancelled = true;
              notifierIt.return?.().catch(() => {});
              throw event.error;
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
