import { AsyncPushable, createAsyncPushable } from "../utils/pushable";
import type { Atom } from "./atom";

/**
 * Represents a value that can either be a synchronous return or a promise that
 * resolves to the value.
 *
 * This type is used to support both synchronous and asynchronous callbacks
 * within stream handlers, providing flexibility without requiring every
 * handler to be an async function.
 *
 * @template T The type of the value returned by the callback.
 */
export type MaybePromise<T = any> = (T | Promise<T>);

/**
 * Type guard that checks whether a value behaves like a promise (thenable).
 *
 * We avoid relying on `instanceof Promise` so that promise-like values from
 * different realms or custom thenables are still treated correctly.
 *
 * Note: the return type is `PromiseLike<unknown>` (not `Promise<unknown>`)
 * because any object with a `.then()` method satisfies this check, not just
 * native Promise instances.
 */
export const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  !!value && typeof (value as any).then === 'function';

/**
 * A constant representing a completed stream result.
 *
 * Always `{ done: true, value: undefined }`.
 * Used to signal the end of a stream.
 */
export const DONE: { readonly done: true; readonly value: undefined; } = Object.freeze({ done: true, value: undefined });

/**
 * Factory function to create a normal stream result.
 *
 * @template R The type of the emitted value.
 * @param value The value to emit downstream.
 * @returns A `IteratorResult<R>` object with `{ done: false, value }`.
 */
export const NEXT = <R = any>(value: R): { readonly done: false; readonly value: R; } => ({ done: false, value }) as const;

/**
 * A stream operator that transforms a value from an input stream to an output stream.
 *
 * Operators are the fundamental building blocks for composing stream transformations.
 * They are functions that take one stream and return another, allowing for a chain of operations.
 *
 * @template T The type of the value being consumed by the operator.
 * @template R The type of the value being produced by the operator.
 */
export type Operator<T = any, R = T> = {
  /**
   * An optional name for the operator, useful for debugging.
   */
  name?: string;
  /**
   * A type discriminator to identify this object as an operator.
   */
  type: 'operator';
  /**
   * The core function that defines the operator's transformation logic. It takes an
   * asynchronous iterator of type `T` and returns a new asynchronous iterator of type `R`.
   * @param source The source async iterator to apply the transformation to.
   */
  apply: (source: AsyncIterator<T>) => AsyncIterator<R>;
};

/**
 * Type guard to check if a value is an Operator.
 *
 * @param value The value to check.
 * @returns True if the value is an Operator.
 */
export const isOperator = (value: unknown): value is Operator =>
  !!value &&
  typeof value === 'object' &&
  (value as any).type === 'operator' &&
  typeof (value as any).apply === 'function';

/**
 * Creates a reusable stream operator.
 *
 * This factory function simplifies the creation of operators by bundling a name and a
 * transformation function into a single `Operator` object.
 *
 * The returned operator automatically fills in missing `return()` and `throw()` methods
 * on the produced iterator so that downstream consumers can always clean up properly:
 *
 * - **Default `return()`**: Forwards to `source.return()` (if present) and returns the
 *   caller-supplied value or the source's return value. Errors from `source.return()` are
 *   logged as warnings rather than silently swallowed.
 * - **Default `throw()`**: Forwards to `source.throw()` (if present). If the source
 *   handles the throw and returns a non-done result, that result is forwarded. Otherwise
 *   the source is cleaned up via `source.return()` and the original error is re-thrown.
 *
 * @template T The type of the value the operator will consume.
 * @template R The type of the value the operator will produce.
 * @param name The name of the operator, for identification and debugging.
 * @param transformFn The transformation function that defines the operator's logic.
 *   Receives the operator instance as `this`, allowing access to `this.name` etc.
 * @returns A new `Operator` object with the specified name and transformation function.
 */
export function createOperator<T = any, R = T>(
  name: string,
  transformFn: (this: Operator<T, R>, source: AsyncIterator<T>) => AsyncIterator<R>
): Operator<T, R> {
  const op: Operator<T, R> = {
    name,
    type: 'operator',
    apply(source) {
      const iterator = transformFn.call(op, source);

      if (typeof iterator.return !== 'function') {
        iterator.return = async (value?: any) => {
          try {
            if (typeof source.return === 'function') {
              const result = await source.return(value);
              // If the source produced a meaningful return value, forward it
              if (result != null && result.done) return result;
            }
          } catch (err) {
            console.warn(`Operator '${name}': source.return() threw during cleanup:`, err);
          }
          return { done: true as const, value };
        };
      }

      if (typeof iterator.throw !== 'function') {
        iterator.throw = async (err?: any) => {
          const error = err instanceof Error ? err : new Error(String(err));
          try {
            if (typeof source.throw === 'function') {
              const result = await source.throw(error);
              // Source handled the throw — forward its result
              if (result.done) return DONE;
              // Cast the result to IteratorResult<R> since the operator transforms T → R
              // The value may need transformation, but we're just forwarding it
              return result as any as IteratorResult<R>;
            }
          } catch (sourceErr) {
            // source.throw() re-threw or threw a different error.
            // Fall through to cleanup + re-throw the original error.
            if (sourceErr !== error) {
              console.warn(`Operator '${name}': source.throw() threw an unexpected error:`, sourceErr);
            }
          }
          // Source doesn't support throw, or couldn't handle it — clean up
          try {
            if (typeof source.return === 'function') {
              await source.return();
            }
          } catch (cleanupErr) {
            console.warn(`Operator '${name}': source.return() threw during throw cleanup:`, cleanupErr);
          }
          throw error;
        };
      }

      return iterator;
    }
  };

  return op;
}

/**
 * Creates a push operator where `setup` receives the source iterator and a pre-created output
 * pushable. `setup` may return an optional cleanup callback that is invoked when the downstream
 * cancels iteration (`return()` / `throw()`).
 *
 * The setup function is guarded by a cancellation gate: once the operator is cancelled (via
 * `return()` or `throw()` on the output), any further pushes to the output are silently ignored.
 * This prevents pushes to a completed/closed output after teardown.
 *
 * @template T The type of values consumed by the operator.
 * @template R The type of values produced by the operator.
 * @param name The name of the operator, for debugging.
 * @param setup A function that receives the source iterator and an output pushable.
 *   May return a cleanup function to be called on cancellation.
 */
export function createPushOperator<T, R = T>(
  name: string,
  setup: (source: AsyncIterator<T>, output: AsyncPushable<R>) => (() => MaybePromise<void>) | void
): Operator<T, R> {
  return createOperator<T, R>(name, function (this: Operator<T, R>, source) {
    const output = createAsyncPushable<R>();
    let cancelled = false;

    // Wrap output.push with a cancellation gate so that the setup function
    // cannot push values after the operator has been torn down.
    const originalPush = output.push.bind(output);
    (output as any).push = (value: R) => {
      if (cancelled) return output;
      return originalPush(value);
    };

    const cleanup = setup(source, output);

    let cleanupCalled = false;
    const runCleanup = async () => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      cancelled = true;
      if (!cleanup) return;
      try {
        await cleanup();
      } catch (err) {
        console.warn(`Operator '${name}': cleanup function threw:`, err);
      }
    };

    const baseReturn = output.return?.bind(output);
    const baseThrow = output.throw?.bind(output);

    (output as any).return = async (value?: any) => {
      await runCleanup();
      try {
        if (typeof source.return === 'function') await source.return();
      } catch (err) {
        console.warn(`Operator '${name}': source.return() threw during output.return():`, err);
      }
      if (!output.disposed) output.dispose();
      return baseReturn ? baseReturn(value) : DONE;
    };

    (output as any).throw = async (err: any) => {
      const error = err instanceof Error ? err : new Error(String(err));
      await runCleanup();
      try {
        if (typeof source.return === 'function') await source.return();
      } catch (cleanupErr) {
        console.warn(`Operator '${name}': source.return() threw during output.throw():`, cleanupErr);
      }
      if (!output.disposed) output.fail(error);
      if (baseThrow) return baseThrow(error);
      throw error;
    };

    return output;
  });
}

/**
 * Recursive conditional type that computes the output type of a chain of operators.
 *
 * Walks the operator array left-to-right, threading each operator's output type
 * into the next operator's input type. Returns `AtomBase<T>` for an empty chain,
 * and falls back to `AtomBase<any>` if type inference is exhausted.
 *
 * @template T The initial stream value type.
 * @template Ops The tuple of operators to apply.
 */
export type PipeResult<T, Ops extends readonly Operator<any, any>[]> =
  Ops extends [] ? Atom<T> :
  Ops extends [Operator<T, infer A>, ...infer Rest]
    ? Rest extends Operator<any, any>[]
      ? PipeResult<A, Rest>
      : Atom<any>
    : Atom<any>;

/**
 * A type representing a chain of stream operators.
 *
 * Uses function overloading to provide strong type safety for a sequence
 * of operators (up to 16). Beyond 16 operators, the recursive `PipeResult`
 * type is used as a fallback so that type safety is preserved as long as
 * TypeScript can infer the chain.
 *
 * @template T The initial type of the stream.
 */

/**
 * Helper type that validates a chain of operators has matching input/output types.
 *
 * Produces a type error (by making the parameter type `never`) when an operator's
 * input type doesn't match the preceding operator's output type.
 *
 * @internal
 */
export type ValidateChain<T, Ops extends readonly Operator<any, any>[]> =
  Ops extends [Operator<T, infer A>, ...infer Rest]
    ? Rest extends Operator<any, any>[]
      ? [Operator<T, A>, ...ValidateChain<A, Rest>]
      : [Operator<T, A>]
    : [];

