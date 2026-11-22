import { __streamixBeginLifetime, type StreamixLifetimeSpan } from '../runtime/introspection-hooks';
import { createOperator, DONE, type MaybePromise, NEXT, type Operator } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from "../factories";
import { normalizeError } from "../atoms";
import { SerialInnerExecution } from "../runtime/serial-inner-execution";
import { prepareProjection } from "../runtime/projected-inner";
import { asStreamixSource } from "../utils/source-protocol";

/**
 * Maps each value from the source stream to an inner stream, ignoring
 * new outer values while the current inner stream is still executing.
 *
 * This operator is useful for preventing overlapping operations (e.g. preventing
 * multiple simultaneous form submissions or API calls). If a new value arrives
 * from the source while an earlier projected stream is still active, that
 * new value is silently discarded.
 * * Only after the current inner stream completes will the operator become
 * "idle" and ready to accept the next value from the source.
 *
 * @template T The type of values emitted by the source stream.
 * @template R The type of values emitted by the produced inner streams.
 * @param project A function that transforms a source value into an {@link Readable | Readable<R>},
 * a {@link MaybePromise<R>}, or an array. It receives the source value and a
 * zero-based index of the emission.
 * @returns An {@link Operator} that performs the "exhaust" transformation.
 */
export const exhaustMap = <T = any, R = any>(
  project: (value: T, index: number) => MaybePromise<PipeInput<R>>
) =>
  createOperator<T, R>("exhaustMap", function (this: Operator, source) {
    let outerIndex = 0;
    const operator = this;
    let lifetime: StreamixLifetimeSpan | undefined;
    const inner = new SerialInnerExecution<R>();
    let isSourceDone = false;

    // Discards outer values that were buffered while an inner stream was
    // running: exhaustMap ignores them by definition. Returns without a value;
    // the only observable effects are the drain and the done flag.
    const discardBufferedOuterValues = (): void => {
      const pollSync = asStreamixSource(source).pollSync;
      if (!pollSync) return;

      while (true) {
        const poll = pollSync.call(source);
        if (poll.status === 'unavailable') return;
        if (poll.result.done) {
          isSourceDone = true;
          return;
        }
        __streamixBeginLifetime(operator)?.finish('dropped');
      }
    };

    return {
      async next() {
        try {
          while (true) {
            if (inner.stopped) return DONE;
            if (inner.active) {
              const result = await inner.next();
              if (inner.stopped) return DONE;

              if (!result.done) {
                lifetime?.output();
                return NEXT(result.value);
              }

              lifetime?.finish('complete');
              discardBufferedOuterValues();
              if (isSourceDone) return DONE;
              continue;
            }

            const result = await source.next();
            if (inner.stopped) return DONE;
            if (result.done) {
              isSourceDone = true;
              return DONE;
            }

            lifetime = __streamixBeginLifetime(operator);
            lifetime?.start();
            try {
              prepareProjection(inner.disposal, () => project(result.value, outerIndex++), projected => {
                if (inner.stopped) return false;
                inner.attach(from<R>(projected)[Symbol.asyncIterator]());
                return true;
              });
            } catch (err) {
              isSourceDone = true;
              throw normalizeError(err);
            }
          }
        } catch (error) { lifetime?.finish('error'); throw error; }
      },

      async return(_value?: any) {
        lifetime?.finish('cancel');
        await inner.close(source);
        return DONE;
      },

      async throw(err: any) {
        lifetime?.finish('error');
        const error = normalizeError(err);
        await inner.close(source);
        throw error;
      }
    };
  });
