import type { MaybePromise } from '../atoms';

/**
 * One value produced by `unfold`, together with the transition to the next state.
 *
 * The transition is a function deliberately: it is not invoked until the
 * consumer requests another value. Return `null` from the step function to end.
 */
export interface UnfoldStep<State, Value> {
  value: Value;
  next: (signal: AbortSignal) => MaybePromise<State>;
}

/**
 * Creates a truly pull-driven async iterable from a state machine.
 *
 * One call to `iterator.next()` evaluates at most one step and produces at most
 * one value. The transition (`step.next`) is deferred until the *following*
 * pull. No timer, microtask, subscription, or background producer is started
 * by this factory. Each iterator has its own state and AbortController.
 *
 * `return()` and `throw()` abort the signal supplied to `step` and `next`.
 * As with other async iterables, an asynchronous callback must cooperate with
 * that signal for prompt cancellation while a pull is pending.
 *
 * Wrap the result with `flow(unfold(...))` when an Atom is needed. Note that
 * `flow()` drives its source while subscribed, so that wrapper does not retain
 * one-pull-per-downstream-next semantics.
 *
 * @example
 * ```ts
 * const numbers = unfold(0, n => n < 3
 *   ? { value: n, next: () => n + 1 }
 *   : null);
 *
 * for await (const number of numbers) console.log(number); // 0, 1, 2
 * ```
 */
export function unfold<State, Value>(
  initialState: State,
  step: (
    state: State,
    signal: AbortSignal
  ) => MaybePromise<UnfoldStep<State, Value> | null>
): AsyncIterable<Value> {
  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<Value> {
      const controller = new AbortController();
      const { signal } = controller;

      const generator = (async function* (): AsyncGenerator<Value, void, unknown> {
        let state = initialState;
        while (!signal.aborted) {
          const result = await step(state, signal);
          if (signal.aborted || result === null) return;

          yield result.value;

          // A consumer that cancels after a value must never advance state.
          if (signal.aborted) return;
          state = await result.next(signal);
        }
      })();

      return {
        next(value?: unknown) {
          return generator.next(value);
        },
        async return() {
          controller.abort();
          return generator.return(undefined);
        },
        async throw(error?: unknown) {
          controller.abort(error);
          return generator.throw(error);
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}
