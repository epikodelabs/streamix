import * as _epikodelabs_streamix from '@epikodelabs/streamix';

/**
 * Async iterator augmented with push methods, passed to operator setup callbacks.
 */
type AsyncPushable<R> = AsyncIterator<R> & AsyncIterable<R> & {
    push(value: R): void | Promise<void>;
    error(err: any): void;
    complete(): void;
    completed(): boolean;
};
/**
 * Creates an `AsyncPushable` - an async iterator that you can manually
 * push values into with backpressure.
 */
declare function createAsyncPushable<R>(): AsyncPushable<R>;

/**
 * A receiver is a set of callbacks for handling next, error, and complete notifications from a stream or subject.
 *
 * @template T The type of values received.
 */
type Receiver<T = any> = {
    next?: (value: T) => MaybePromise;
    error?: (err: any) => MaybePromise;
    complete?: () => MaybePromise;
};
/**
 * A strict receiver is a receiver with all callbacks required and a completed flag.
 *
 * @template T The type of values received.
 */
type StrictReceiver<T = any> = Required<Receiver<T>> & {
    readonly completed: boolean;
};
/**
 * Create a strict receiver from a callback or receiver object.
 *
 * @template T The type of values received.
 * @param {((value: T) => MaybePromise) | Receiver<T>} [callbackOrReceiver] - Callback or receiver object.
 * @returns {StrictReceiver<T>} A strict receiver instance.
 */
declare function createReceiver<T = any>(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): StrictReceiver<T>;

/**
 * Represents a subscription to a stream-like source.
 *
 * A `Subscription` is returned from a stream's `subscribe()` method and
 * represents an active connection between a producer and a consumer.
 *
 * Responsibilities:
 * - Tracks whether the subscription is active
 * - Provides an idempotent mechanism to unsubscribe
 * - Optionally executes cleanup logic on unsubscribe
 */
type Subscription = {
    /**
     * Indicates whether the subscription has been terminated.
     *
     * - `false` - subscription is active
     * - `true`  - subscription has been unsubscribed and is inactive
     *
     * This flag becomes `true` immediately when `unsubscribe()` is invoked
     * for the first time.
     */
    readonly unsubscribed: boolean;
    /**
     * Terminates the subscription.
     *
     * Semantics:
     * - Idempotent: calling multiple times has no additional effect
     * - Marks the subscription as unsubscribed synchronously
     * - Executes cleanup logic (if provided) exactly once
     * - Stream receivers may still get `complete()` as a cleanup signal
     *
     * Errors thrown by cleanup logic are caught and suppressed.
     *
     * @returns A `MaybePromise<void>` that resolves when cleanup completes
     */
    unsubscribe(): MaybePromise;
    /**
     * Optional cleanup callback executed during unsubscription.
     *
     * Intended usage:
     * - Remove event listeners
     * - Cancel timers or async tasks
     * - Abort generators or observers
     *
     * Guarantees:
     * - Called at most once
     * - Executed only after `unsubscribed` becomes `true`
     * - May be synchronous or asynchronous
     *
     * Any errors thrown by this callback are caught internally.
     */
    teardown?: () => MaybePromise;
};
/**
 * Creates a new `Subscription` instance.
 *
 * This factory encapsulates subscription state and ensures:
 * - Safe, idempotent unsubscription
 * - Proper execution of cleanup logic
 * - Consistent error handling during teardown
 *
 * @param teardown Optional cleanup callback executed on first unsubscribe
 * @returns {Subscription} A new Subscription object
 */
declare function createSubscription(teardown?: () => MaybePromise): Subscription;

/**
 * A Stream is an async iterable with additional methods for piping, subscribing, and querying values.
 *
 * @template T The type of values emitted by the stream.
 */
type Stream<T = any> = AsyncIterable<T> & {
    type: string;
    name?: string;
    pipe: OperatorChain<T>;
    subscribe(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription;
    query: () => Promise<T>;
    toArray: () => Promise<T[]>;
    [Symbol.asyncIterator](): AsyncIterator<T>;
};
/**
 * Type guard to check if a value is stream-like (has type and async iterator).
 *
 * @template T
 * @param value The value to check.
 * @returns {boolean} True if the value is a Stream.
 */
declare const isStreamLike: <T = unknown>(value: unknown) => value is Stream<T>;
declare function streamToArray<T>(stream: Stream<T>): Promise<T[]>;
/**
 * Creates a multicast {@link Stream} from an async generator factory.
 *
 * The returned Stream starts producing values on the first subscription and
 * delivers each yielded value to *all* active subscribers.
 *
 * - When the last subscriber unsubscribes, the underlying generator is aborted
 *   via an {@link AbortSignal}.
 * - When the generator completes, subscribers are completed and internal
 *   receiver references are cleared to avoid memory growth in long-running
 *   processes/tests.
 * - A new subscription after completion starts a fresh generator run.
 *
 * Receiver callbacks are executed in a microtask when there is no active
 * emission context, which helps keep delivery ordering consistent and avoids
 * surprising re-entrancy.
 *
 * @template T Value type emitted by the stream.
 * @param name Human-friendly name (used for debugging/tracing).
 * @param generatorFn Async generator factory. Receives an optional AbortSignal
 * that is aborted when the stream is torn down.
 * @returns A Stream that can be piped, subscribed to, or iterated.
 *
 * @example
 * const s = createStream('ticks', async function* (signal) {
 *   while (!signal?.aborted) {
 *     yield Date.now();
 *     await new Promise(r => setTimeout(r, 1000));
 *   }
 * });
 */
declare function createStream<T>(name: string, generatorFn: (signal?: AbortSignal) => AsyncGenerator<T, void, unknown>): Stream<T>;
/**
 * Applies a list of operators to a source stream and returns the resulting stream.
 *
 * This is the implementation behind `stream.pipe(...)`.
 *
 * @template TIn Source value type.
 * @param source Source stream.
 * @param operators Operators to apply, in order.
 * @returns A new Stream that emits the transformed values.
 */
declare function pipeSourceThrough<TIn, TOut = TIn, Ops extends Operator<any, any>[] = Operator<any, any>[]>(source: Stream<TIn>, operators: [...Ops]): Stream<TOut>;

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
type MaybePromise<T = any> = (T | Promise<T>);
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
declare const isPromiseLike: (value: unknown) => value is PromiseLike<unknown>;
/**
 * A constant representing a completed stream result.
 *
 * Always `{ done: true, value: undefined }`.
 * Used to signal the end of a stream.
 */
declare const DONE: {
    readonly done: true;
    readonly value: undefined;
};
/**
 * Factory function to create a normal stream result.
 *
 * @template R The type of the emitted value.
 * @param value The value to emit downstream.
 * @returns A `IteratorResult<R>` object with `{ done: false, value }`.
 */
declare const NEXT: <R = any>(value: R) => {
    readonly done: false;
    readonly value: R;
};
/**
 * A stream operator that transforms a value from an input stream to an output stream.
 *
 * Operators are the fundamental building blocks for composing stream transformations.
 * They are functions that take one stream and return another, allowing for a chain of operations.
 *
 * @template T The type of the value being consumed by the operator.
 * @template R The type of the value being produced by the operator.
 */
type Operator<T = any, R = T> = {
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
declare const isOperator: (value: unknown) => value is Operator;
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
declare function createOperator<T = any, R = T>(name: string, transformFn: (this: Operator<T, R>, source: AsyncIterator<T>) => AsyncIterator<R>): Operator<T, R>;
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
declare function createPushOperator<T, R = T>(name: string, setup: (source: AsyncIterator<T>, output: AsyncPushable<R>) => (() => MaybePromise<void>) | void): Operator<T, R>;
/**
 * Recursive conditional type that computes the output type of a chain of operators.
 *
 * Walks the operator array left-to-right, threading each operator's output type
 * into the next operator's input type. Returns `Stream<T>` for an empty chain,
 * and falls back to `Stream<any>` if type inference is exhausted.
 *
 * @template T The initial stream value type.
 * @template Ops The tuple of operators to apply.
 */
type PipeResult<T, Ops extends readonly Operator<any, any>[]> = Ops extends [] ? Stream<T> : Ops extends [Operator<T, infer A>, ...infer Rest] ? Rest extends Operator<any, any>[] ? PipeResult<A, Rest> : Stream<any> : Stream<any>;
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
interface OperatorChain<T> {
    (): Stream<T>;
    <A>(op1: Operator<T, A>): Stream<A>;
    <A, B>(op1: Operator<T, A>, op2: Operator<A, B>): Stream<B>;
    <A, B, C>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>): Stream<C>;
    <A, B, C, D>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>): Stream<D>;
    <A, B, C, D, E>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>): Stream<E>;
    <A, B, C, D, E, F>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>): Stream<F>;
    <A, B, C, D, E, F, G>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>): Stream<G>;
    <A, B, C, D, E, F, G, H>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>): Stream<H>;
    <A, B, C, D, E, F, G, H, I>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>): Stream<I>;
    <A, B, C, D, E, F, G, H, I, J>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>): Stream<J>;
    <A, B, C, D, E, F, G, H, I, J, K>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>): Stream<K>;
    <A, B, C, D, E, F, G, H, I, J, K, L>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>): Stream<L>;
    <A, B, C, D, E, F, G, H, I, J, K, L, M>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>): Stream<M>;
    <A, B, C, D, E, F, G, H, I, J, K, L, M, N>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>): Stream<N>;
    <A, B, C, D, E, F, G, H, I, J, K, L, M, N, O>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>, op15: Operator<N, O>): Stream<O>;
    <A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P>(op1: Operator<T, A>, op2: Operator<A, B>, op3: Operator<B, C>, op4: Operator<C, D>, op5: Operator<D, E>, op6: Operator<E, F>, op7: Operator<F, G>, op8: Operator<G, H>, op9: Operator<H, I>, op10: Operator<I, J>, op11: Operator<J, K>, op12: Operator<K, L>, op13: Operator<L, M>, op14: Operator<M, N>, op15: Operator<N, O>, op16: Operator<O, P>): Stream<P>;
    /**
     * Fallback for chains longer than 16 operators.
     * Uses the recursive PipeResult type to preserve type safety
     * as long as TypeScript can resolve the conditional type.
     */
    <Ops extends Operator<any, any>[]>(...operators: Ops & ValidateChain<T, Ops>): PipeResult<T, Ops>;
}
/**
 * Helper type that validates a chain of operators has matching input/output types.
 *
 * Produces a type error (by making the parameter type `never`) when an operator's
 * input type doesn't match the preceding operator's output type.
 *
 * @internal
 */
type ValidateChain<T, Ops extends readonly Operator<any, any>[]> = Ops extends [Operator<T, infer A>, ...infer Rest] ? Rest extends Operator<any, any>[] ? [Operator<T, A>, ...ValidateChain<A, Rest>] : [Operator<T, A>] : [];

/**
 * Converts a `Stream` into an async generator, yielding each emitted value.
 *
 * The generator handles all stream events:
 * - Each yielded value corresponds to a real `next` emission, including undefined.
 * - The generator terminates when the stream `complete`s.
 * - It throws an error if the stream emits an `error` event.
 *
 * @template T The type of the values emitted by the stream.
 * @param stream The source stream to convert.
 * @returns An async generator that yields the values from the stream.
 */
declare function eachValueFrom<T = any>(stream: Stream<T>): AsyncGenerator<T>;

/**
 * Returns a promise that resolves with the first emitted value from a `Stream`.
 *
 * - If the stream emits a value, the promise resolves with that value.
 * - If the stream emits an error, the promise rejects with that error.
 * - If the stream completes without ever emitting a value, the promise rejects with an `Error`.
 *
 * @template T The type of the value that the promise will resolve with.
 * @param stream The source stream to listen to.
 * @returns A promise that resolves with the first value from the stream or rejects on error or completion without a value.
 */
declare function firstValueFrom<T = any>(stream: Stream<T>): Promise<T>;

/**
 * Converts various value types into a Stream.
 *
 * This function normalizes different input types into a consistent Stream interface:
 * - Streams are passed through as-is
 * - Promises are awaited and their resolved values are processed
 * - Arrays have each element emitted individually
 * - Single values are emitted as-is
 *
 * @template R The type of values emitted by the resulting stream.
 * @param value The input value to convert. Can be:
 *   - a {@link Stream<R>}
 *   - a `Promise<R>` (single value)
 *   - a `Promise<Array<R>>` (multiple values from array)
 *   - a plain value `R`
 *   - an array `Array<R>`
 * @returns A {@link Stream<R>} that emits the normalized values.
 */
declare function fromAny<R = any>(value: Stream<R> | MaybePromise<R> | Array<R> | Iterable<R> | AsyncIterable<R>): Stream<R>;

/**
 * Returns a promise that resolves with the last emitted value from a `Stream`.
 *
 * - **Successful resolution:** The promise resolves with the last value
 *   emitted by the stream, after the stream has completed.
 * - **Rejection on error:** If the stream emits an error, the promise is rejected.
 * - **Rejection on no value:** If the stream completes without emitting any
 *   values, the promise is rejected with a specific error message.
 *
 * @template T The type of the value expected from the stream.
 * @param stream The source stream to listen to for the final value.
 * @returns A promise that resolves with the last value from the stream or rejects on completion without a value or on error.
 */
declare function lastValueFrom<T = any>(stream: Stream<T>): Promise<T>;

/**
 * Creates a stream operator that emits the latest value from the source stream
 * at most once per specified duration.
 *
 * Each incoming value is stored as the "latest"; a timer emits that latest value
 * when the duration elapses. All values that arrive between timer ticks and are
 * ultimately superseded are forwarded with `dropped: true` so that backpressure
 * is released without surfacing them as real emissions.
 *
 * @template T The type of the values in the stream.
 * @param duration The time in milliseconds (or a promise resolving to it) to wait
 * before emitting the latest value.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const audit: <T = any>(duration: MaybePromise<number>) => _epikodelabs_streamix.Operator<T, T>;

/**
 * Buffers values from the source stream and emits them as arrays every `period` milliseconds.
 *
 * @template T The type of the values in the source stream.
 * @param period Time in milliseconds between each buffer flush.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
declare function buffer<T = any>(period: MaybePromise<number>): _epikodelabs_streamix.Operator<T, T[]>;

/**
 * Buffers a fixed number of values from the source stream and emits them as arrays,
 * tracking pending and phantom values in the PipeContext.
 *
 * @template T The type of values in the source stream.
 * @param bufferSize The maximum number of values per buffer (default: Infinity).
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
declare const bufferCount: <T = any>(bufferSize?: MaybePromise<number>) => Operator<T, T[]>;

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
declare const bufferUntil: <T = any, N = any>(notifier: Stream<N>) => Operator<T, T[]>;

/**
 * Buffers values while the provided predicate returns `true`.
 *
 * The predicate is evaluated for each incoming value against the *current* buffer (before the value is added).
 * If it resolves to `true`, the value is appended to the current buffer. If it resolves to `false`, the current
 * buffer is flushed and a new buffer is started with the incoming value.
 *
 * When the source completes, any remaining buffered values are emitted automatically.
 *
 * @template T Source value type.
 * @param predicate Function invoked for each value to decide whether the value should remain in the current buffer.
 * Receives the incoming value, the index, and the current buffer (before pushing the value). It may return a promise.
 */
declare const bufferWhile: <T = any>(predicate: (value: T, index: number, buffer: T[]) => MaybePromise<boolean>) => Operator<T, T[]>;

/**
 * Creates a stream operator that catches errors from the source stream and handles them.
 *
 * This operator listens for errors from the upstream source. When the first error is
 * caught, it invokes a provided `handler` callback, yields a single dropped result
 * for that error, and then completes on the following pull, preventing the error
 * from propagating further down the pipeline.
 *
 * - **Error Handling:** The `handler` is executed only for the first error encountered.
 * - **Dropped Signal:** The first handled error is yielded with `dropped: true` so
 *   backpressure is released and downstream operators can observe the suppressed error.
 * - **Completion:** After that dropped signal, the operator completes, terminating
 *   the stream's flow.
 * - **Subsequent Errors:** Any errors after the first will be re-thrown.
 *
 * This is useful for error-handling strategies where you want to perform a specific
 * cleanup action and then gracefully terminate the stream.
 *
 * @template T The type of the values emitted by the stream.
 * @param handler The function to call when an error is caught. It can return a `void` or a `Promise<void>`.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const catchError: <T = any>(handler?: (error: any) => MaybePromise<void>) => Operator<T, T>;

/**
 * Creates a stream operator that maps each value from the source stream to a new
 * inner stream (or value/array/promise) and flattens all inner streams sequentially.
 *
 * For each value from the source:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link fromAny}.
 * 3. The inner stream is consumed fully before processing the next outer value.
 *
 * This ensures that all emitted values maintain their original sequential order.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner streams and the output.
 * @param project A function that takes a value from the source stream and its index,
 * and returns either:
 *   - a {@link Stream<R>},
 *   - a {@link MaybePromise<R>},
 *   - or an array of `R`.
 * @returns An {@link Operator} instance that can be used in a stream's `pipe` method.
 */
declare const concatMap: <T = any, R = any>(project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>) => Operator<T, R>;

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * only after a specified duration has passed without another new value.
 *
 * Values that are superseded before the timeout fires are forwarded to the output
 * with `dropped: true` so that backpressure is released without surfacing them as
 * real emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param duration The debounce duration in milliseconds.
 * @returns An Operator instance for use in a stream pipeline.
 */
declare function debounce<T = any>(duration: MaybePromise<number>): _epikodelabs_streamix.Operator<T, T>;

/**
 * Creates a stream operator that emits a default value if the source stream is empty.
 *
 * This operator monitors the source stream for any emitted values. If the source
 * stream completes without emitting any values, this operator will emit a single
 * `defaultValue` and then complete. If the source stream does emit at least one value,
 * this operator will pass all values through and will not emit the `defaultValue`.
 *
 * @template T The type of the values in the stream.
 * @param defaultValue The value to emit if the source stream is empty.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const defaultIfEmpty: <T = any>(defaultValue: MaybePromise<T>) => Operator<T, T>;

/**
 * Creates a stream operator that delays the emission of each value from the source stream.
 *
 * Each value received from the source is held for the specified duration before
 * being emitted downstream.
 *
 * @template T The type of the values in the source and output streams.
 * @param ms The time in milliseconds to delay each value.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
declare function delay<T = any>(ms: MaybePromise<number>): _epikodelabs_streamix.Operator<T, T>;

/**
 * Delay values from the source until a notifier emits.
 *
 * This operator buffers every value produced by the source stream and releases
 * them only after the provided `notifier` produces its first emission. After the
 * notifier emits, the operator flushes the buffered values and forwards all
 * subsequent source values immediately.
 *
 * Important semantics:
 * - Buffering: values are buffered until the notifier emits, then flushed in order
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, buffered values are discarded and the operator will not forward
 *   any buffered values (it simply waits for the source to continue/complete).
 * - Error propagation: any error from the notifier or source is propagated to
 *   the output (the operator records the error and terminates the output
 *   iterator accordingly).
 *
 * Use-cases:
 * - Delay producing values until an initialization step completes (e.g. wait
 *   for a connection or configuration event).
 * - Gate values until user interaction or external readiness signal occurs.
 *
 * @template T Source/output value type.
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `Stream<N>` or `Promise<N>` that gates the source.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
declare function delayUntil<T = any, N = any>(notifier: Stream<N> | Promise<N>): Operator<T, T>;

/**
 * Buffers values while a predicate returns `true` and releases them once the predicate flips to `false`.
 *
 * This operator evaluates the provided predicate for every value coming from the source stream.
 * - When the predicate resolves to `true`, the value is held in an internal queue.
 * - Once the predicate returns `false` for the first time, all buffered values are flushed in order,
 *   including the current value, and the operator resumes emitting immediately.
 * - The operator can re-enter the buffering state later if the predicate becomes `true` again.
 * - When the source completes while values are buffered, those values are flushed before completing.
 *
 * The predicate is allowed to return either a boolean or a promise of a boolean.
 *
 * @template T The type of values flowing through the stream.
 * @param predicate Function to test each value. Receives the value and its index; `true` means delay, `false` means emit immediately.
 */
declare const delayWhile: <T = any>(predicate: (value: T, index: number) => MaybePromise<boolean>) => _epikodelabs_streamix.Operator<T, T>;

/**
 * Creates a stream operator that emits values from the source stream only if
 * they are different from the previous value.
 *
 * Consecutive duplicate values are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe the suppressed
 * emissions without treating them as real values.
 *
 * @template T The type of the values in the stream.
 * @param comparator An optional function that compares the previous and current values.
 * It should return `true` if they are considered the same, and `false` otherwise.
 * If not provided, a strict equality check (`===`) is used.
 * @returns An `Operator<T, T>` instance that can be used in a stream's `pipe` method.
 */
declare const distinctUntilChanged: <T = any>(comparator?: (prev: T, curr: T) => MaybePromise<boolean>) => Operator<T, T>;

/**
 * Creates a stream operator that filters out consecutive values from the source
 * stream if a specified key's value has not changed.
 *
 * This operator is a specialized version of `distinctUntilChanged`. It checks for
 * uniqueness based on the value of a single property (`key`). Consecutive values
 * where the key has not changed are yielded with `dropped: true` so that backpressure
 * is released and downstream operators can observe suppressed emissions.
 *
 * @template T The type of the objects in the stream. Must extend `object`.
 * @template K The key of the property to check for changes.
 * @param key The name of the property to check for changes.
 * @param comparator An optional function to compare the previous and current values of the `key`.
 * It should return `true` if the values are considered the same. If not provided,
 * strict inequality (`!==`) is used.
 * @returns An `Operator<T, T>` instance that can be used in a stream's `pipe` method.
 */
declare const distinctUntilKeyChanged: <T extends object = any, K extends keyof T = keyof T>(key: MaybePromise<K>, comparator?: (prev: T[K], curr: T[K]) => MaybePromise<boolean>) => Operator<T, T>;

/**
 * Creates a stream operator that emits a final, specified value after the source stream has completed.
 *
 * The operator first consumes all values from the upstream source. Once the source stream signals
 * its completion (`done`), this operator then emits the `finalValue` and immediately completes.
 *
 * @template T The type of the values in the stream.
 * @param finalValue The value to be emitted as the last item in the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const endWith: <T = any>(finalValue: MaybePromise<T>) => Operator<T, T>;

/**
 * Maps each value from the source stream to an inner stream, ignoring
 * new outer values while the current inner stream is still executing.
 *
 * This operator is useful for preventing overlapping operations (e.g., preventing
 * multiple simultaneous form submissions or API calls). If a new value arrives
 * from the source while an earlier projected stream is still active, that
 * new value is silently discarded.
 * * Only after the current inner stream completes will the operator become
 * "idle" and ready to accept the next value from the source.
 *
 * @template T The type of values emitted by the source stream.
 * @template R The type of values emitted by the produced inner streams.
 * @param project A function that transforms a source value into a {@link Stream},
 * a {@link MaybePromise<R>}, or an array. It receives the source value and a
 * zero-based index of the emission.
 * @returns An {@link Operator} that performs the "exhaust" transformation.
 */
declare const exhaustMap: <T = any, R = any>(project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>) => Operator<T, R>;

/**
 * Options for the expand operator.
 *
 * @property {'depth' | 'breadth'} [traversal] - Traversal strategy: 'depth' (default) or 'breadth'.
 * @property {number} [maxDepth] - Maximum recursion depth.
 */
type ExpandOptions = {
    traversal?: 'depth' | 'breadth';
    maxDepth?: number;
};
/**
 * Creates a stream operator that recursively expands each emitted value.
 *
 * This operator takes each value from the source stream and applies the `project`
 * function to it, which must return a new stream. It then recursively applies
 * the same logic to each value emitted by that new stream, effectively
 * flattening an infinitely deep, asynchronous data structure.
 *
 * This is particularly useful for traversing graph or tree-like data, such as
 * file directories or hierarchical API endpoints, where each item might lead
 * to a new collection of items that also need to be processed.
 *
 * @template T The type of the values in the source and output streams.
 * @param project A function that takes a value and returns a stream, value/array,
 * or a promise of those shapes to be expanded.
 * @param options An optional configuration object for traversal strategy and max depth.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const expand: <T = any>(project: (value: T) => MaybePromise<Stream<T> | Array<T> | T>, options?: ExpandOptions) => Operator<T, T>;

/**
 * Creates a stream operator that filters values emitted by the source stream.
 *
 * This operator provides flexible filtering capabilities. It processes each value
 * from the source stream and passes it through to the output stream only if it meets
 * a specific criterion.
 *
 * The filtering can be configured in one of three ways:
 * - A **predicate function**: A function that returns `true` for values to be included.
 * - A **single value**: Only values that are strictly equal (`===`) to this value are included.
 * - An **array of values**: Only values that are present in this array are included.
 *
 * Values that do not pass the filter are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe suppressed emissions.
 *
 * @template T The type of the values in the stream.
 * @param predicateOrValue The filtering criterion. Can be a predicate function, a single value, or an array of values.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const filter: <T = any>(predicateOrValue: ((value: T, index: number) => MaybePromise<boolean>) | T | T[]) => Operator<T, T>;

/**
 * Creates a stream operator that invokes a finalizer callback upon stream termination.
 *
 * This operator is useful for performing cleanup tasks, such as closing resources
 * or logging, after a stream has completed or encountered an error. The provided
 * `callback` is guaranteed to be called exactly once, regardless of whether the
 * stream terminates gracefully or with an error.
 *
 * @template T The type of the values emitted by the stream.
 * @param callback The function to be called when the stream completes or errors.
 * It can be synchronous or return a Promise.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const finalize: <T = any>(callback: () => MaybePromise<void>) => Operator<T, T>;

/**
 * Creates a stream operator that emits only the first element from the source stream
 * that matches an optional predicate.
 *
 * This operator is designed to find a specific value and then immediately terminate.
 * - If a `predicate` function is provided, the operator will emit the first value for which
 *   the predicate returns a truthy value.
 * - If no predicate is provided, it will simply emit the very first value from the source.
 *
 * After emitting a single value, the operator completes. If the source stream completes
 * before a matching value is found, an error is thrown.
 *
 * @template T The type of the values in the source stream.
 * @param predicate An optional function to test each value. It receives the value
 * and should return `true` to indicate a match.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 * @throws {Error} Throws an error with the message "No elements in sequence" if no matching
 * value is found before the source stream completes.
 */
declare const first: <T = any>(predicate?: (value: T) => MaybePromise<boolean>) => Operator<T, T>;

/**
 * Represents a conditional branch for the `fork` operator.
 *
 * Each `ForkOption` defines:
 * 1. A predicate function `on` to test source values.
 * 2. A handler function `handler` that produces a stream (or value/array/promise) when the predicate matches.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the handler and output stream.
 */
interface ForkOption<T = any, R = any> {
    /**
     * Predicate function to determine if this option should handle a value.
     *
     * @param value The value from the source stream.
     * @param index The zero-based index of the value in the source stream.
     * @returns A boolean or a `Promise<boolean>` indicating whether this option matches.
     */
    on: (value: T, index: number) => MaybePromise<boolean>;
    /**
     * Handler function called for values that match the predicate.
     *
     * Can return:
     * - a {@link Stream<R>}
     * - a {@link MaybePromise<R>}
     * - an array of `R`
     *
     * @param value The source value that matched the predicate.
     * @returns A stream, value, promise, or array to be flattened and emitted.
     */
    handler: (value: T) => (Stream<R> | MaybePromise<R> | Array<R>);
}
/**
 * Creates a stream operator that routes each source value through a specific handler
 * based on matching predicates defined in the provided `ForkOption`s.
 *
 * For each value from the source stream:
 * 1. Iterates over the `options` array.
 * 2. Executes the `on` predicate for each option until one returns `true`.
 * 3. Calls the corresponding `handler` for the first matching option.
 * 4. Flattens the result (stream, value, promise, or array) sequentially into the output stream.
 *
 * If no predicate matches a value, an error is thrown.
 *
 * This operator allows conditional branching in streams based on the content of each item.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the output stream.
 * @param options {@link ForkOption} objects defining predicates and handlers.
 * @returns An {@link Operator} instance suitable for use in a stream's `pipe` method.
 *
 * @throws {Error} If a source value does not match any predicate.
 */
declare const fork: <T = any, R = any>(...options: Array<ForkOption<T, R>>) => Operator<T, R>;

/**
 * Represents a grouped item with its original value and the associated key.
 * @template T The type of the original value.
 * @template K The type of the group key.
 */
type GroupItem<T = any, K = any> = {
    value: T;
    key: K;
};
/**
 * Creates a stream operator that groups values from the source stream by a computed key.
 *
 * This operator is a projection operator that transforms a stream of values into a
 * stream of `GroupItem` objects. For each value from the source, it applies the
 * `keySelector` function to determine a key and then emits an object containing both
 * the original value and the computed key.
 *
 * This operator is the first step in a typical grouping pipeline. The resulting stream
 * of `GroupItem` objects can then be processed further by other operators (e.g., `scan`
 * or `reduce`) to perform a true grouping into collections.
 *
 * @template T The type of the values in the source stream.
 * @template K The type of the key computed by `keySelector`.
 * @param keySelector A function that takes a value from the source stream and returns
 * a key. This function can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const groupBy: <T = any, K = any>(keySelector: (value: T) => MaybePromise<K>) => Operator<T, GroupItem<T, K>>;

/**
 * Creates a stream operator that ignores all values emitted by the source stream.
 *
 * This operator consumes the source stream but does not emit any values. It only
 * forwards the completion or error signal from the source stream. This is useful
 * when you only care about the "end" of an operation, not the intermediate results.
 * For example, waiting for a stream of side effects to complete before continuing.
 *
 * @template T The type of the values in the source stream (which are ignored).
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const ignoreElements: <T>() => Operator<T, never>;

/**
 * Creates a stream operator that emits only the last value from the source stream
 * that matches an optional predicate.
 *
 * This operator must consume the entire source stream to find the last matching
 * value. It caches the last value that satisfies the `predicate` (or the last
 * value of the stream if no predicate is provided) and emits it only when the
 * source stream completes.
 *
 * @template T The type of the values in the source stream.
 * @param predicate An optional function to test each value. It receives the value
 * and should return `true` to indicate a match.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 * @throws {Error} Throws an error with the message "No elements in sequence" if no
 * matching value is found before the source stream completes.
 */
declare const last: <T = any>(predicate?: (value: T) => MaybePromise<boolean>) => Operator<T, T>;

/**
 * Creates a stream operator that applies a transformation function to each value
 * emitted by the source stream.
 *
 * This operator is a fundamental part of stream processing. It consumes each value
 * from the source, passes it to the `transform` function, and then emits the result
 * of that function. This is a one-to-one mapping, meaning the output stream will
 * have the same number of values as the source stream, but with potentially different
 * content and/or type.
 *
 * @template T The type of the values in the source stream.
 * @template R The type of the values in the output stream.
 * @param transform The transformation function to apply to each value. It receives
 * the value and its index. This function can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const map: <T = any, R = any>(transform: (value: T, index: number) => MaybePromise<R>) => Operator<T, R>;

/**
 * Creates a stream operator that maps each value from the source stream to an "inner" stream
 * and merges all inner streams concurrently into a single output stream.
 *
 * For each value from the source stream:
 * 1. The `project` function is called with the value and its index.
 * 2. The returned value is normalized into a stream using {@link fromAny}.
 * 3. The inner stream is consumed concurrently with all other active inner streams.
 * 4. Emitted values from all inner streams are interleaved into the output stream.
 *
 * This operator is useful for performing parallel asynchronous operations while
 * preserving all emitted values in a merged output with correct temporal ordering.
 *
 * @template T The type of values in the source stream.
 * @template R The type of values emitted by the inner and output streams.
 * @param project A function that maps a source value and its index to either:
 *   - a {@link Stream<R>},
 *   - a {@link MaybePromise<R>},
 *   - or an array of `R`.
 * @param concurrent Maximum number of concurrent inner streams (default: Infinity).
 * @param bufferSize Maximum number of source values to queue when concurrency limit is reached (default: Infinity).
 * @returns An {@link Operator} instance that can be used in a stream's `pipe` method.
 *
 * @example
 * ```typescript
 * // Process HTTP requests with max 3 concurrent
 * stream(urls).pipe(
 *   mergeMap(url => fetch(url), 3)
 * )
 * ```
 */
declare function mergeMap<T = any, R = any>(project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>, concurrent?: number, bufferSize?: number): Operator<T, R>;

/**
 * Creates a stream operator that schedules the emission of each value from the source
 * stream on a specified JavaScript task queue.
 *
 * This operator is a scheduler. It decouples the timing of value production from
 * its consumption, allowing you to control when values are emitted to downstream
 * operators. This is essential for preventing long-running synchronous operations
 * from blocking the main thread and for prioritizing different types of work.
 *
 * The operator supports three contexts:
 * - `"microtask"`: Emits the value at the end of the current task using `queueMicrotask`.
 * - `"macrotask"`: Emits the value in the next event loop cycle using `setTimeout(0)`.
 * - `"idle"`: Emits the value when the browser is idle using `requestIdleCallback`.
 *
 * @template T The type of the values in the source and output streams.
 * @param context The JavaScript task queue context to schedule emissions on.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const observeOn: <T = any>(context: MaybePromise<"microtask" | "macrotask" | "idle">) => Operator<T, T>;

/**
 * Creates a stream operator that partitions the source stream into two groups based on a predicate.
 *
 * This operator is a specialized form of `groupBy`. For each value from the source stream,
 * it applies the provided `predicate` function. It then emits a new object, a `GroupItem`,
 * containing the original value and a key of `"true"` or `"false"`, indicating whether the
 * value satisfied the predicate.
 *
 * This operator does not create two physical streams, but rather tags each item with its
 * group membership, allowing for subsequent conditional routing or processing.
 *
 * @template T The type of the values in the source stream.
 * @param predicate A function that takes a value and its index and returns a boolean or
 * `Promise<boolean>`. `true` for one group, `false` for the other.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method,
 * emitting objects of type `GroupItem<T, "true" | "false">`.
 */
declare const partition: <T = any>(predicate: (value: T, index: number) => MaybePromise<boolean>) => Operator<T, GroupItem<T, "true" | "false">>;

/**
 * Creates a stream operator that accumulates all values from the source stream
 * into a single value using a provided accumulator function.
 *
 * This operator consumes the source lazily and emits intermediate values as phantoms.
 * It will always emit at least the seed value if the stream is empty.
 *
 * @template T The type of the values in the source stream.
 * @template A The type of the accumulated value.
 * @param accumulator Function combining current accumulated value with a new value.
 * Can be synchronous or asynchronous.
 * @param seed Initial value for the accumulator.
 * @returns An `Operator` instance usable in a stream's `pipe` method.
 */
declare const reduce: <T = any, A = any>(accumulator: (acc: A, value: T) => MaybePromise<A>, seed: A) => Operator<T, A>;

/**
 * Creates a stream operator that emits the most recent value from the source stream
 * at a fixed periodic interval.
 *
 * Values that arrive between sample ticks and are not emitted are forwarded with
 * `dropped: true` so that backpressure is released without surfacing them as real
 * emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param period The time in milliseconds between each emission.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
declare const sample: <T = any>(period: MaybePromise<number>) => _epikodelabs_streamix.Operator<T, T>;

/**
 * Creates a stream operator that accumulates values from the source stream,
 * emitting each intermediate accumulated result.
 *
 * This operator is stateful and is ideal for scenarios where you need to maintain
 * a running total or build a state object over the life of a stream. It takes a
 * `seed` value and an `accumulator` function. For each value from the source,
 * it applies the accumulator and emits the new result immediately.
 *
 * @template T The type of the values in the source stream.
 * @template R The type of the accumulated value and the output stream.
 * @param accumulator The function that combines the current accumulated value
 * with the new value from the source. This function can be synchronous or asynchronous.
 * @param seed The initial value for the accumulator.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const scan: <T = any, R = any>(accumulator: (acc: R, value: T, index: number) => MaybePromise<R>, seed: R) => Operator<T, R>;

/**
 * Creates a stream operator that emits only the values at the specified indices from a source stream.
 *
 * This operator takes an `indexIterator` (which can be a synchronous or asynchronous iterator
 * of numbers) and uses it to determine which values from the source stream should be emitted.
 * It acts as a positional filter: each source value is inspected once, and if its zero-based
 * index matches the next index yielded by `indexIterator`, that value is emitted. No buffering
 * of past values occurs. If the iterator completes, the operator completes regardless of
 * remaining source values.
 *
 * @template T The type of the values in the source and output streams.
 * @param indexIterator An iterator or async iterator that provides the zero-based indices
 * of the elements to be emitted.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const select: <T = any>(indexIterator: Iterator<number> | AsyncIterator<number>) => Operator<T, T>;

/**
 * Shares a single subscription to the source stream between multiple consumers.
 *
 * This operator multicasts the upstream iterator through an internal subject so
 * that every subsequent consumer receives the same values without re-running the source.
 * The subject does not replay values for late subscribers; they receive only values
 * emitted after they subscribe.
 *
 * @template T Value type in the shared stream.
 * @returns An operator that can be inserted into a pipeline to share the source.
 */
declare function share<T = any>(): Operator<T, T>;

/**
 * Creates a stream operator that shares a single subscription to the source stream
 * and replays a specified number of past values to new subscribers.
 *
 * This operator multicasts the source stream, ensuring that multiple downstream
 * consumers can receive values from a single source connection. It uses an internal
 * subscriber queue and a bounded replay buffer so that late subscribers receive the
 * most recent values before continuing with live emissions.
 *
 * This is useful for:
 * - Preventing redundant execution of a source stream (e.g. a network request).
 * - Providing a "state history" to late subscribers.
 *
 * @template T The type of the values in the stream.
 * @param bufferSize The number of last values to replay to new subscribers. Defaults to `Infinity`.
 *                   Can be a Promise that resolves to a number.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare function shareReplay<T = any>(bufferSize?: MaybePromise<number>): Operator<T, T>;

/**
 * Creates a stream operator that skips the first specified number of values from the source stream.
 *
 * This operator is useful for "fast-forwarding" a stream. It consumes the initial `count` values
 * from the source stream without emitting them to the output. Once the count is reached,
 * it begins to pass all subsequent values through unchanged.
 *
 * Skipped values are yielded with `dropped: true` so that backpressure is released and
 * downstream operators can observe the suppressed emissions.
 *
 * @template T The type of the values in the source and output streams.
 * @param count The number of values to skip from the beginning of the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const skip: <T = any>(count: MaybePromise<number>) => Operator<T, T>;

/**
 * Skip source values until a notifier emits.
 *
 * `skipUntil` suppresses (drops) source values until the provided `notifier`
 * produces its first emission. After the notifier emits, subsequent source
 * values are forwarded normally.
 *
 * Values suppressed before the gate opens are yielded with `dropped: true` so
 * that backpressure is released and downstream operators can observe the
 * suppressed emissions.
 *
 * Important details:
 * - Notifier completion without emission: if the notifier completes without
 *   emitting, the operator remains closed and continues to drop source values.
 * - Error propagation: errors from either the notifier or source are propagated
 *   to the output and will terminate the subscription.
 *
 * @template T Source/output value type.
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `Stream<N>` or `Promise<N>` that opens the gate when it emits.
 * @returns An `Operator<T, T>` that drops source values until the notifier emits.
 */
declare function skipUntil<T = any, N = any>(notifier: Stream<N> | Promise<N>): Operator<T, T>;

/**
 * Creates a stream operator that skips values from the source stream while a predicate returns true.
 *
 * Values skipped while the predicate holds are yielded with `dropped: true` so that
 * backpressure is released and downstream operators can observe suppressed emissions.
 * As soon as the predicate returns `false` for the first time, this operator emits
 * that value and all subsequent values normally.
 *
 * @template T The type of the values in the source and output streams.
 * @param predicate The function to test each value. Receives the value and its index. `true` means to continue skipping,
 * and `false` means to stop skipping and begin emitting.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const skipWhile: <T = any>(predicate: (value: T, index: number) => MaybePromise<boolean>) => Operator<T, T>;

/**
 * Creates a stream operator that emits pairs of values from the source stream,
 * where each pair consists of the previous and the current value.
 *
 * This operator is a powerful tool for comparing consecutive values in a stream.
 * It maintains an internal state to remember the last value it received. For
 * each new value, it creates a tuple of `[prior, currentValue]` and
 * emits it to the output stream.
 *
 * The very first value emitted will have `undefined` as its "previous" value.
 *
 * @template T The type of the values in the source stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method,
 * emitting tuples of `[T | undefined, T]`.
 */
declare const slidingPair: <T = any>() => Operator<T, [T | undefined, T]>;

/**
 * Creates a stream operator that prepends a specified value to the beginning of the stream.
 *
 * The operator first emits the `initialValue` immediately upon being iterated.
 * After this initial emission, it begins to pull and emit values from the
 * source stream as they become available.
 *
 * @template T The type of the values in the stream.
 * @param initialValue The value to be emitted as the first item in the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const startWith: <T = any>(initialValue: MaybePromise<T>) => Operator<T, T>;

/**
 * Transforms each value from the source stream into a new inner stream, promise, or array,
 * and emits values only from the most recently created inner stream.
 *
 * When a new value is emitted from the source, the previous inner stream (if any) is cancelled
 * and unsubscribed, and a new inner stream is created using the `project` function. Only values
 * from the latest inner stream are emitted to the output. If the projected value is a {@link MaybePromise<R>} or array,
 * it is normalized to a stream.
 *
 * If the source completes and there is no active inner stream, the output completes. If an error occurs
 * in the source, the projection function, or the inner stream, the output emits an error and completes.
 *
 * @typeParam T - The type of values emitted by the source stream.
 * @typeParam R - The type of values emitted by the projected inner streams.
 * @param project - A function that receives each value and index from the source stream and returns a stream, a {@link MaybePromise<R>}, or array of values to be emitted.
 * @returns An operator function that can be applied to a stream, emitting values from the most recent inner stream created by the projection function.
 *
 * @example
 * ```ts
 * // For each number, start a new timer stream and emit its ticks, cancelling the previous timer.
 * source.pipe(switchMap(n => timerStream(n)))
 * ```
 */
declare function switchMap<T = any, R = any>(project: (value: T, index: number) => Stream<R> | MaybePromise<R> | Array<R>): Operator<T, R>;

/**
 * Creates a stream operator that emits only the first `count` values from the source stream
 * and then completes.
 *
 * This operator is a powerful tool for controlling the length of a stream. It consumes values
 * from the source one by one, and as long as the total number of values emitted is less than
 * `count`, it passes them through to the output. Once the count is reached, it stops
 * processing the source and signals completion to its downstream consumers. This is especially
 * useful for managing finite segments of large or infinite streams.
 *
 * @template T The type of the values in the source and output streams.
 * @param count The maximum number of values to take from the beginning of the stream.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const take: <T = any>(count: MaybePromise<number>) => Operator<T, T>;

/**
 * Take values from the source until a notifier emits.
 *
 * This operator forwards values from the source stream until the notifier
 * emits its first value or completes. Once the notifier emits, the operator
 * completes immediately and unsubscribes from the source.
 *
 * Important semantics:
 * - If notifier emits before any source values, no source values are emitted
 * - If source completes before notifier emits, operator completes normally
 * - Errors from either source or notifier are propagated
 *
 * @template T Source/output value type.
 * @template N Notifier value type (ignored by this operator).
 * @param notifier A `Stream<N>` or `Promise<N>` that signals when to stop taking.
 * @returns An `Operator<T, T>` that can be used in a stream pipeline.
 */
declare function takeUntil<T = any, N = any>(notifier: Stream<N> | Promise<N>): Operator<T, T>;

/**
 * Creates a stream operator that emits values from the source stream as long as
 * a predicate returns true.
 *
 * This operator is a conditional limiter. It consumes values from the source stream
 * and applies the `predicate` function to each. As long as the predicate returns `true`,
 * the value is passed through to the output stream. The first time the predicate returns
 * a falsy value, the operator stops emitting and immediately completes the output stream.
 * The value that caused the predicate to fail is not emitted.
 *
 * This is useful for taking a contiguous block of data from a stream that meets a certain
 * condition, such as processing user input until an invalid entry is made.
 *
 * @template T The type of the values in the source and output streams.
 * @param predicate The function to test each value. Receives the value and its index. `true` means to continue emitting,
 * and `false` means to stop and complete. It can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const takeWhile: <T = any>(predicate: (value: T, index: number) => MaybePromise<boolean>) => Operator<T, T>;

/**
 * Creates a stream operator that performs a side-effect for each value from the source
 * stream without modifying the value.
 *
 * This operator is primarily used for debugging, logging, or other non-intrusive
 * actions that need to be performed on each value as it passes through the pipeline.
 * It is completely transparent to the data stream itself, as it does not transform,
 * filter, or buffer the values. The provided `tapFunction` is executed for each
 * value before the value is emitted to the next operator.
 *
 * @template T The type of the values in the source and output streams.
 * @param tapFunction The function to perform the side-effect. It receives the value
 * from the stream and can be synchronous or asynchronous.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
declare const tap: <T = any>(tapFunction: (value: T) => MaybePromise<any>) => Operator<T, T>;

/**
 * Creates a throttle operator that emits the first value immediately, then ignores subsequent
 * values for the specified duration. If new values arrive during the cooldown, the
 * last one is emitted after the cooldown expires (trailing emit).
 *
 * Values suppressed during the cooldown window are forwarded with `dropped: true` so
 * that backpressure is released without surfacing them as real emissions. Only the
 * trailing value (if any) is emitted normally after the cooldown.
 *
 * @template T The type of values emitted by the source and output.
 * @param duration The throttle duration in milliseconds.
 * @returns An Operator instance that applies throttling to the source stream.
 */
declare const throttle: <T = any>(duration: MaybePromise<number>) => _epikodelabs_streamix.Operator<T, T>;

/**
 * Creates a stream operator that immediately throws an error with the provided message.
 *
 * This operator is a source operator that is used to create a stream that immediately
 * fails. When a consumer requests a value by calling `next()`, the operator
 * will throw an `Error` with the given `message`, without emitting any values.
 *
 * This is useful for testing error handling logic in a stream pipeline or for
 * explicitly modeling a failed asynchronous operation.
 *
 * @template T The type of the values in the stream (this is a formality, as no values are emitted).
 * @param message The error message to be thrown.
 * @returns An `Operator` instance that creates a stream which errors upon its first request.
 */
declare const throwError: <T = any>(message: MaybePromise<string>) => Operator<T, never>;

/**
 * Collects all emitted values from the source stream into an array
 * and emits that array once the source completes, tracking pending state.
 *
 * @template T The type of the values in the source stream.
 * @returns An Operator instance for use in a stream's `pipe` method.
 */
declare const toArray: <T = any>() => Operator<T, T[]>;

/**
 * Combines the source stream with the latest values from one or more auxiliary streams or promises.
 *
 * When the source stream emits a value, this operator emits a tuple containing that source value
 * along with the most recent values from each auxiliary input.
 *
 * @typeParam T - The type of values emitted by the source stream.
 * @typeParam R - A readonly array/tuple representing the types emitted by the auxiliary streams.
 * @param args - One or more streams, promises, or an array of streams/promises whose latest values
 * will be combined with the source value.
 * @returns A push operator function that transforms the source stream into a stream of combined tuples.
 *
 * @example
 * ```ts
 * const clicks = fromEvent(document, 'click');
 * const mouseMoves = fromEvent(document, 'mousemove');
 *
 * clicks.pipe(withLatestFrom(mouseMoves)).subscribe({
 * next: ([clickEvent, lastMouseMove]) => {
 * console.log('Clicked at:', lastMouseMove.clientX, lastMouseMove.clientY);
 * }
 * });
 * ```
 */
declare function withLatestFrom<T = any, R extends readonly unknown[] = any[]>(...args: any[]): _epikodelabs_streamix.Operator<T, [T, ...R]>;

/**
 * A function that releases a lock or a permit.
 * @callback ReleaseFn
 * @returns {void}
 */
type ReleaseFn = () => void;
/**
 * An interface for a function that creates a simple asynchronous lock.
 *
 * @interface
 * Prefer scheduler-backed or stream-based coordination utilities for most use cases.
 */
type SimpleLock = () => Promise<ReleaseFn>;
/**
 * Creates a simple asynchronous lock mechanism. Only one caller can hold the lock at a time.
 * Subsequent calls will queue up and wait for the lock to be released. This is useful
 * for synchronizing access to shared resources in an asynchronous environment.
 *
 * The function returns a promise that resolves with a `ReleaseFn`. The caller must
 * invoke this function to release the lock, allowing the next queued caller to proceed.
 *
 * @returns {SimpleLock} A function that, when called, returns a promise to acquire the lock.
 * Prefer scheduler-backed or stream-based coordination utilities for most use cases.
 */
declare const createLock: () => SimpleLock;

declare function createQueue(): {
    enqueue: (operation: () => Promise<any>) => Promise<any>;
    readonly pending: number;
    readonly isEmpty: boolean;
};

/**
 * An interface for a semaphore, a synchronization primitive for controlling
 * access to a limited number of resources.
 *
 * @interface
 * Prefer scheduler-backed or stream-based coordination utilities for most use cases.
 */
type Semaphore = {
    /**
     * Acquires a permit from the semaphore. If no permits are available,
     * this promise-based method will block until a permit is released.
     *
     * @returns {Promise<ReleaseFn>} A promise that resolves with a function to call to release the permit.
     */
    acquire: () => Promise<ReleaseFn>;
    /**
     * Attempts to acquire a permit from the semaphore without blocking.
     *
     * @returns {ReleaseFn | null} A function to call to release the permit if one was acquired, otherwise `null`.
     */
    tryAcquire: () => ReleaseFn | null;
    /**
     * Releases a permit back to the semaphore. This unblocks the next waiting
     * `acquire` call in the queue or increments the available permit count.
     */
    release: () => void;
};
/**
 * Creates a semaphore for controlling access to a limited number of resources.
 *
 * A semaphore is a synchronization primitive that allows you to manage
 * concurrent access to resources by maintaining a count of available "permits."
 *
 * @param {number} initialCount The initial number of permits available. Must be a non-negative integer.
 * @returns {Semaphore} A semaphore object with `acquire`, `tryAcquire`, and `release` methods.
 * Prefer scheduler-backed or stream-based coordination utilities for most use cases.
 */
declare const createSemaphore: (initialCount: number) => Semaphore;

/**
 * Combines multiple streams and emits a tuple containing the latest values
 * from each stream whenever any of the source streams emits a new value.
 *
 * This operator is useful for scenarios where you need to react to changes
 * in multiple independent data sources simultaneously. The output stream
 * will not emit a value until all source streams have emitted at least one
 * value. The output stream completes when all source streams have completed.
 *
 * @template {unknown[]} T A tuple type representing the combined values from the sources.
 * @param sources Streams or values (including promises) to combine.
 * @returns {Stream<T>} A new stream that emits a tuple of the latest values from all source streams.
 */
declare function combineLatest<T extends unknown[] = any[]>(...sources: Array<Stream<T[number]> | Promise<T[number]>>): Stream<T>;

/**
 * Creates a transactional retrying stream that commits values only after a full
 * attempt completes successfully.
 *
 * Unlike {@link retry}, this operator buffers values produced during each
 * attempt. If an attempt fails, the buffered values are discarded and the next
 * retry starts from a clean state. When an attempt completes, its buffered
 * values are emitted downstream in order.
 *
 * This is useful when retries should preserve all-or-nothing visibility for a
 * sequence, while {@link retry} itself remains pass-through.
 *
 * @template T The type of values emitted by the source stream.
 * @param factory A factory executed for each attempt. The produced result is
 * normalized through {@link fromAny}, so it may be a stream, a promise, or a
 * plain value.
 * @param maxRetries The maximum number of retry operations allowed. A value of
 * `0` runs a single attempt.
 * @param delay The delay window in milliseconds to pause between attempts.
 * @returns A stream that emits values only after an attempt finishes
 * successfully.
 */
declare function commit<T = any>(factory: () => Stream<T> | MaybePromise<T>, maxRetries?: MaybePromise<number>, delay?: MaybePromise<number>): Stream<T>;

/**
 * Concatenates sources sequentially.
 *
 * `concat(a, b, c)` subscribes to `a`, yields all its values, waits for it to
 * complete, then moves to `b`, then `c`.
 *
 * - If any source errors, the concatenated stream errors and remaining sources
 *   are not processed.
 * - Sources may be Streams, raw values, arrays/iterables, or Promises of those.
 *
 * @template T Value type.
 * @param sources Streams or values (including promises) to concatenate.
 * @returns A new stream that emits values from all input sources in order.
 *
 * @example
 * const s = concat(from([1, 2]), from([3]), 4);
 * // emits: 1, 2, 3, 4
 */
declare function concat<T = any>(...sources: (Stream<T> | Promise<T>)[]): Stream<T>;

/**
 * Creates a stream that defers the creation of an inner stream until it is
 * subscribed to.
 *
 * This operator ensures that the `factory` function is called only when
 * a consumer subscribes to the stream, making it a good choice for
 * creating "cold" streams. Each new subscription will trigger a new
 * call to the `factory` and create a fresh stream instance.
 *
 * @template T The type of the values in the inner stream.
 * @param {() => (Stream<T> | Promise<T>)} factory A function that returns the stream or value to be subscribed to.
 * @returns {Stream<T>} A new stream that defers subscription to the inner stream.
 */
declare function defer<T = any>(factory: () => Stream<T> | MaybePromise<T>): Stream<T>;

/**
 * Creates an empty stream that emits no values and completes immediately.
 *
 * @template T The type of the stream's values (will never be emitted).
 * @returns {Stream<T>} An empty stream.
 */
declare const empty: <T = any>() => Stream<T>;
/**
 * A singleton instance of an empty stream.
 *
 * This constant provides a reusable, empty stream that immediately completes
 * upon subscription without emitting any values. It is useful in stream
 * compositions as a placeholder or to represent a sequence with no elements.
 */
declare const EMPTY: Stream<any>;

/**
 * Waits for all sources to complete and emits an array of their last values.
 *
 * This is similar to RxJS `forkJoin`:
 * - Each source is consumed fully.
 * - The output emits exactly once (an array of the last value from each source)
 *   and then completes.
 * - If any source errors, the output errors.
 * - If any source completes without emitting a value, `forkJoin` errors.
 *
 * Sources may be Streams or plain values (including promises). Plain values are
 * converted to streams via `fromAny(...)`.
 *
 * @template T The type of the last values emitted by each stream.
 * @param sources Streams or values (including promises) to join.
 * @returns A stream that emits a single array of last values.
 *
 * @example
 * const s = forkJoin(from([1, 2]), from([10]));
 * // emits: [2, 10]
 */
declare function forkJoin<T = any, R extends readonly unknown[] = any[]>(...sources: {
    [K in keyof R]: Stream<R[K]> | Promise<R[K]>;
}): Stream<T[]>;
/**
 * Overload that accepts an array/tuple of sources.
 *
 * @template T
 * @template R
 * @param sources Tuple/array of sources.
 * @returns A stream that emits a single array of last values.
 */
declare function forkJoin<T = any, R extends readonly unknown[] = any[]>(sources: {
    [K in keyof R]: Stream<R[K]> | Promise<R[K]>;
}): Stream<T[]>;

/**
 * Creates a stream from an asynchronous or synchronous iterable.
 *
 * This operator is a powerful way to convert any source that can be iterated
 * over (such as arrays, strings, `Map`, `Set`, `AsyncGenerator`, etc.) into
 * a reactive stream. The stream will emit each value from the source in order
 * before completing.
 *
 * @template T The type of the values in the iterable.
 * @param {AsyncIterable<T> | Iterable<T> | PromiseLike<AsyncIterable<T> | Iterable<T>>} source The iterable source to convert into a stream.
 * @returns {Stream<T>} A new stream that emits each value from the source.
 */
declare function from<T = any>(source: MaybePromise<AsyncIterable<T> | Iterable<T>>): Stream<T>;

/**
 * Creates a stream that emits events of the specified type from the given EventTarget.
 *
 * This function provides a reactive way to handle DOM events or other events,
 * such as mouse clicks, keyboard presses, or custom events. The stream
 * will emit a new event object each time the event is dispatched.
 *
 * The stream handles:
 * - Promise-based resolution of both target and event name
 * - Automatic cleanup when the last subscriber unsubscribes
 * - Multicast to multiple subscribers
 * - Proper error propagation if event listener setup fails
 *
 * @template T The type of the event to listen for.
 * @param target The event target to listen to (e.g., a DOM element, `window`, or `document`).
 *               Can be a direct EventTarget or a Promise that resolves to one.
 * @param event The name of the event to listen for (e.g., 'click', 'keydown').
 *              Can be a direct string or a Promise that resolves to one.
 * @param options Optional event listener options (e.g., `{ once: false, passive: true }`).
 * @returns A stream that emits the event objects as they occur.
 *
 * @example
 * // Basic usage
 * const clicks = fromEvent(document.getElementById('myButton'), 'click');
 * clicks.subscribe(console.log);
 *
 * @example
 * // With async target (e.g., waiting for DOM element)
 * const asyncButton = waitForElement('#myButton');
 * const clicks = fromEvent(asyncButton, 'click');
 *
 * @example
 * // With custom event
 * const customEvents = fromEvent(window, 'my-custom-event');
 */
declare function fromEvent<T extends Event = Event>(target: MaybePromise<EventTarget>, event: MaybePromise<string>, options?: AddEventListenerOptions | boolean): Stream<T>;

/**
 * Creates a stream from a value, promise, or a cancelable asynchronous factory.
 *
 * The input can be:
 * - A value
 * - A promise
 * - A function that returns a value or promise, and optionally reacts to cancellation via an {@link AbortSignal}.
 *
 * The factory function (if provided) is invoked on subscription and receives an {@link AbortSignal}
 * that is aborted when the stream is unsubscribed. If the factory throws or returns a rejected promise,
 * the stream will emit an error.
 *
 * @typeParam T - The type of the emitted value.
 * @param input - A value, promise, or a function producing a value or promise, optionally using the provided abort signal for cancellation.
 * @returns A stream that emits the produced value and then completes.
 */
declare function fromPromise<T>(input: MaybePromise<T> | ((signal: AbortSignal) => MaybePromise<T>)): Stream<T>;

/**
 * Creates a stream that chooses between two streams based on a condition.
 *
 * The condition is evaluated lazily when the stream is subscribed to. This allows
 * for dynamic stream selection based on runtime state.
 *
 * @template T The type of the values in the streams.
 * @param {() => MaybePromise<boolean>} condition A function that returns a boolean to determine which stream to use. It is called when the iif stream is subscribed to.
 * @param {Stream<T> | Promise<T>} trueStream The stream or value to use if the condition is `true`.
 * @param {Stream<T> | Promise<T>} falseStream The stream or value to use if the condition is `false`.
 * @returns {Stream<T>} A new stream that emits values from either `trueStream` or `falseStream` based on the condition.
 */
declare function iif<T = any>(condition: () => MaybePromise<boolean>, trueStream: Stream<T> | Promise<T>, falseStream: Stream<T> | Promise<T>): Stream<T>;

/**
 * Creates a stream that emits incremental numbers starting from 0 at a regular
 * interval.
 *
 * This operator is a shorthand for `timer(0, intervalMs)`, useful for
 * creating a simple, repeating sequence of numbers. The stream emits a new
 * value every `intervalMs` milliseconds. It is analogous to `setInterval` but
 * as an asynchronous stream.
 *
 * @param {MaybePromise<number>} intervalMs The time in milliseconds between each emission.
 * @returns {Stream<number>} A stream that emits incrementing numbers (0, 1, 2, ...).
 */
declare function interval(intervalMs: MaybePromise<number>): Stream<number>;

/**
 * Creates a stream that emits values in a loop based on a condition and an
 * iteration function.
 *
 * This operator is useful for generating a sequence of values until a specific
 * condition is no longer met. It starts with an `initialValue` and, for each
 * iteration, it yields the current value and then uses `iterateFn` to
 * calculate the next value in the sequence.
 *
 * @template T The type of the values in the stream.
 * @param {MaybePromise<T>} initialValue The starting value for the loop.
 * @param {(value: T) => MaybePromise<boolean>} condition A function that returns `true` to continue the loop and `false` to stop.
 * @param {(value: T) => MaybePromise<T>} iterateFn A function that returns the next value in the sequence.
 * @returns {Stream<T>} A stream that emits the generated sequence of values.
 */
declare function loop<T = any>(initialValue: MaybePromise<T>, condition: (value: T) => MaybePromise<boolean>, iterateFn: (value: T) => MaybePromise<T>): Stream<T>;

/**
 * Merges multiple source streams into a single stream, emitting values as they arrive from any source.
 *
 * This is useful for combining data from multiple independent sources into a single,
 * unified stream of events. Unlike `zip`, it does not wait for a value from every
 * stream before emitting; it emits values as they become available.
 *
 * The merged stream completes only after all source streams have completed.
 * If any source stream errors, the merged stream immediately errors.
 *
 * **Performance characteristics:**
 * - Synchronous sources with buffered values are drained immediately
 * - Asynchronous sources are pulled concurrently
 *
 * @template T The type of the values in the streams.
 * @param sources Streams or values (including promises) to merge.
 * @returns {Stream<T>} A new stream that emits values from all input streams.
 *
 * @example
 * ```typescript
 * const fast = interval(10);
 * const slow = interval(100);
 * const instant = from([1, 2, 3]);
 *
 * // Values emitted as they arrive
 * merge(fast, slow, instant).forEach(console.log);
 * ```
 */
declare function merge<T = any>(...sources: (Stream<T> | Promise<T>)[]): Stream<T>;

/**
 * Creates a stream that emits a single value and then completes.
 *
 * This operator is useful for scenarios where you need to treat a static,
 * single value as a stream. It immediately yields the provided `value`
 * and then signals completion, which is a common pattern for creating a
 * "hot" stream from a predefined value.
 *
 * @template T The type of the value to be emitted.
 * @param {MaybePromise<T>} value The single value to emit.
 * @returns {Stream<T>} A new stream that emits the value and then completes.
 */
declare function of<T = any>(value: MaybePromise<T>): Stream<T>;

/**
 * Returns a stream that races multiple input streams.
 * It emits values from the first stream that produces a value,
 * then cancels all other streams.
 *
 * This operator is useful for scenarios where you only need the result from the fastest
 * of several asynchronous operations. For example, fetching data from multiple servers
 * and only taking the result from the one that responds first.
 *
 * Once the winning stream completes, the output stream also completes.
 * If the winning stream emits an error, the output stream will emit that error.
 *
 * @template {readonly unknown[]} T - A tuple type representing the combined values from the streams.
 * @param streams Streams or values (including promises) to race against each other.
 * @returns {Stream<T[number]>} A new stream that emits values from the first stream to produce a value.
 */
declare function race<T extends readonly unknown[] = any[]>(...streams: Array<Stream<T[number]> | Promise<T[number]>>): Stream<T[number]>;

/**
 * Creates a stream that emits a sequence of numbers, starting from `start`,
 * incrementing by `step`, and emitting a total of `count` values.
 *
 * This operator is a powerful way to generate a numerical sequence in a
 * reactive context. It's similar to a standard `for` loop but produces
 * values as a stream. It's built upon the `loop` operator for its
 * underlying logic.
 *
 * @param {MaybePromise<number>} start - The first number to emit in the sequence.
 * @param {MaybePromise<number>} count - The total number of values to emit. Must be a non-negative number.
 * @param {MaybePromise<number>} [step=1] - The amount to increment or decrement the value in each step.
 * @returns {Stream<number>} A stream that emits a sequence of numbers.
 */
declare function range(start: MaybePromise<number>, count: MaybePromise<number>, step?: MaybePromise<number>): Stream<number>;

/**
 * Creates a stream that subscribes to a source factory and retries the entire sequence on error.
 *
 * Values are yielded as each attempt produces them. If an attempt fails after emitting some values,
 * those values stay visible downstream and the operator restarts the factory for the next attempt.
 *
 * Abortion: the operator honors the abort signal during stream iteration and between-retry delays,
 * clearing allocations safely without event listener leaks.
 *
 * @template T - The type of values emitted by the source stream.
 * @param {() => (Stream<T> | Promise<T>)} factory - A factory function executed on each initialization attempt.
 * @param {MaybePromise<number>} [maxRetries=3] - The maximum number of retry operations allowed. A value of 0 runs a single attempt.
 * @param {MaybePromise<number>} [delay=1000] - The delay window in milliseconds to pause between attempts.
 * @returns {Stream<T>} A stream that retries the sequence factory after errors.
 */
declare function retry<T = any>(factory: () => Stream<T> | Promise<T>, maxRetries?: MaybePromise<number>, delay?: MaybePromise<number>): Stream<T>;

/**
 * Creates a timer stream that emits numbers starting from 0.
 *
 * This stream is useful for scheduling events or generating periodic data.
 * It is analogous to `setInterval` but as an asynchronous stream.
 *
 * @param {number} [delayMs=0] - The time in milliseconds to wait before emitting the first value (0).
 * If 0, the first value is emitted immediately (in the next microtask).
 * @param {number} [intervalMs] - The time in milliseconds between subsequent emissions.
 * If not provided, it defaults to `delayMs`.
 * @returns {Stream<number>} A stream that emits incrementing numbers (0, 1, 2, ...).
 */
declare function timer(delayMs?: MaybePromise<number>, intervalMs?: MaybePromise<number>): Stream<number>;

/**
 * Combine multiple streams into a single stream that emits arrays of the latest values
 * from each input stream whenever any input emits. Emission occurs only when all inputs
 * have emitted at least once.
 *
 * @template T
 * @param {...Stream<T[number]>[]} sources - The input streams to zip.
 * @returns {Stream<T>} A stream emitting arrays of values from each input.
 */
declare function zip<T extends readonly unknown[] = any[]>(...sources: Array<Stream<T[number]> | Promise<T[number]>>): Stream<T>;

/**
 * BehaviorSubject holds a current value and emits it immediately to new
 * subscribers. It exposes imperative `next`/`complete`/`error` methods and
 * guarantees `value` is always available.
 *
 * @template T
 */
type BehaviorSubject<T = any> = Stream<T> & {
    next(value: T): void;
    complete(): void;
    error(err: any): void;
    completed(): boolean;
    get value(): T;
    subscribe(callback: (value: T) => MaybePromise): Subscription;
    subscribe(receiver: Receiver<T>): Subscription;
    subscribe(): Subscription;
    subscribe(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription;
    query: () => Promise<T>;
    toArray: () => Promise<T[]>;
};
/**
 * Create a `BehaviorSubject` seeded with `initialValue`.
 *
 * @template T
 * @param {T} initialValue - initial value held by the subject
 * @returns {BehaviorSubject<T>} a new behavior subject
 */
declare function createBehaviorSubject<T = any>(initialValue: T): BehaviorSubject<T>;

/**
 * Subject is a hot, multicast stream that allows imperatively pushing values
 * with `next`, signalling completion with `complete`, or errors with
 * `error`. It implements `Stream<T>` and exposes the current value via
 * the `value` getter when available.
 *
 * @template T
 */
type Subject<T = any> = Stream<T> & {
    next(value: T): void;
    complete(): void;
    error(err: any): void;
    completed(): boolean;
    get value(): T | undefined;
    subscribe(callback: (value: T) => MaybePromise): Subscription;
    subscribe(receiver: Receiver<T>): Subscription;
    subscribe(): Subscription;
    subscribe(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription;
};
/**
 * Create a plain `Subject` which buffers emissions and delivers them to
 * current subscribers. The returned subject can be used as an async
 * iterable and as an imperative emitter via `next`/`complete`/`error`.
 *
 * @template T
 * @returns {Subject<T>} A new subject instance.
 */
declare function createSubject<T = any>(): Subject<T>;

/**
 * ReplaySubject replays a bounded history of values to late subscribers.
 * It buffers up to `capacity` items and delivers them before continuing
 * with live emissions.
 *
 * @template T
 */
type ReplaySubject<T = any> = Subject<T> & {
    subscribe(callback: (value: T) => MaybePromise): Subscription;
    subscribe(receiver: Receiver<T>): Subscription;
    subscribe(): Subscription;
    subscribe(callbackOrReceiver?: ((value: T) => MaybePromise) | Receiver<T>): Subscription;
    query: () => Promise<T>;
    toArray: () => Promise<T[]>;
};
/**
 * Create a `ReplaySubject` with an optional capacity of buffered items.
 *
 * @template T
 * @param {number} [capacity=Infinity] - max number of values to retain
 * @returns {ReplaySubject<T>} a new replay subject
 */
declare function createReplaySubject<T = any>(capacity?: number): ReplaySubject<T>;

/**

 * Event emitted by the coordinator for each source.
 *
 * - `value`: A value was emitted from a source.
 * - `complete`: The source completed.
 * - `error`: The source errored.
 *
 * @typeParam T - The type of value emitted by the sources.
 */
type RunnerEvent<T> = {
    type: "value";
    value: T;
    sourceIndex: number;
} | {
    type: "complete";
    sourceIndex: number;
} | {
    type: "error";
    error: any;
    sourceIndex: number;
};
/**
 * Options for {@link createAsyncCoordinator}.
 */
interface AsyncCoordinatorOptions {
    /**
     * If true, drain initial sources synchronously instead of deferring to a microtask.
     */
    syncDrain?: boolean;
}
/**
 * An async iterator that coordinates multiple sources.
 *
 * Supports dynamic source management and both sync and async draining.
 *
 * @typeParam T - The type of value emitted by the sources.
 */
interface AsyncCoordinator<T> extends AsyncIterator<RunnerEvent<T>> {
    /**
     * Synchronously drain all available values from all sources (if supported).
     * Returns DONE if all sources are complete, otherwise null if no values are available.
     */
    __tryNext?: () => IteratorResult<RunnerEvent<T>> | null;
    /**
     * Returns true if there are buffered values or all sources are done.
     */
    __hasBufferedValues?: () => boolean;
    /**
     * Dynamically add a new source to the coordinator.
     * @param source - The async iterator to add.
     * @param key - Optional key used to remove the source by reference later.
     * @returns The index assigned to the new source.
     */
    addSource(source: AsyncIterator<T>, key?: any): number;
    /**
     * Remove a source from the coordinator and clean it up.
     * @param index - The index of the source to remove.
     */
    removeSource(index: number): Promise<void>;
    /**
     * Remove a source by the key passed to {@link addSource}.
     * @param key - The key of the source to remove.
     */
    removeSourceByKey(key: any): Promise<void>;
    /**
     * Batch multiple source additions/removals and emit a single notification
     * after the batch completes.
     * @param callback - Function that performs source changes.
     */
    batch(callback: () => void): void;
    /**
     * Get the number of currently active (non-completed, non-removed) sources.
     * @returns The count of active sources.
     */
    getActiveSourceCount(): number;
    /**
     * Check if a specific source is completed or removed.
     * @param index - The source index to check.
     * @returns True if the source is completed or removed, false otherwise.
     */
    isSourceComplete(index: number): boolean;
}
/**
 * Creates an async coordinator that merges multiple async iterators.
 *
 * The coordinator supports:
 * - Synchronous draining for sources that support it (via `__tryNext`)
 * - Concurrent async pulling for async sources
 * - Push notification support for sources with `__onPush`
 * - Dynamic addition and removal of sources during iteration
 * - Automatic cleanup and error propagation
 *
 * The returned coordinator is itself an async iterator that yields {@link RunnerEvent} objects, indicating
 * value, completion, or error from each source. The coordinator can be used in `for await` loops or manually
 * via `.next()`. It also exposes methods for dynamic source management.
 *
 * @typeParam T - The type of value emitted by the sources.
 * @param sources - Initial array of async iterators (can be empty).
 * @returns An {@link AsyncCoordinator} with dynamic source management capabilities.
 *
 * @example
 * ```ts
 * const coordinator = createAsyncCoordinator<number>([stream1, stream2]);
 * for await (const event of coordinator) {
 *   if (event.type === 'value') {
 *     // event.value from event.sourceIndex
 *   }
 * }
 * ```
 */
declare function createAsyncCoordinator<T = any>(sources?: AsyncIterator<T>[], options?: AsyncCoordinatorOptions): AsyncCoordinator<T>;
/**
 * Gets an iterator from an iterable object.
 * Supports both synchronous and asynchronous iterables.
 *
 * @param iterable The iterable to get an iterator from.
 * @returns An `AsyncIterator` or `Iterator`.
 * @throws If the provided object is not iterable.
 */
declare function getIterator<T>(iterable: AsyncIterable<T> | Iterable<T>): AsyncIterator<T> | Iterator<T>;
/**
 * Races an iterator's `next()` call against an `AbortSignal`.
 * If the signal is aborted, the promise resolves with a `done: true` result.
 */
declare function raceNext<T>(iterator: AsyncIterator<T> | Iterator<T>, signal: AbortSignal): Promise<IteratorResult<T>>;

/**
 * Shared queue item structure used across all async iterator implementations
 */
interface QueueItem<T> {
    result: IteratorResult<T>;
}
/**
 * Pending error state
 */
interface PendingError {
    err: any;
}
/**
 * Core state management for async iterators with pull/push coordination
 */
declare class AsyncIteratorState<T> {
    readonly queue: QueueItem<T>[];
    readonly backpressureQueue: Array<() => void>;
    pullResolve: ((v: IteratorResult<T>) => void) | null;
    pullReject: ((e: any) => void) | null;
    pendingError: PendingError | null;
    completed: boolean;
    /**
     * Check if there are any buffered values, errors, or completion
     */
    hasBufferedValues(): boolean;
    /**
     * Clear all pending resolvers and backpressure
     */
    clear(): void;
    /**
     * Mark as completed and clear state
     */
    markCompleted(): void;
    /**
     * Enqueue a value
     */
    enqueueValue(value: T): void;
    /**
     * Enqueue completion
     */
    enqueueCompletion(): void;
}
/**
 * Safely normalizes any thrown/rejected value to an Error instance.
 * Preserves real Error instances (and their stack traces); otherwise wraps
 * primitives and objects in `new Error(String(err))`.
 */
declare function normalizeError(err: any): Error;
/**
 * Synchronous pull handler - implements __tryNext logic
 */
declare function syncPull<T>(state: AsyncIteratorState<T>, _iterator: any, onDone?: () => void): IteratorResult<T> | null;
/**
 * Asynchronous pull handler - implements next() logic
 */
declare function asyncPull<T>(state: AsyncIteratorState<T>, _iterator: any, onDone?: () => void): Promise<IteratorResult<T>>;
/**
 * Push a value with backpressure support
 */
declare function pushValue<T>(state: AsyncIteratorState<T>, _iterator: any, value: T, onPush?: () => void): void | Promise<void>;
/**
 * Push a completion signal
 */
declare function pushComplete<T>(state: AsyncIteratorState<T>, _iterator: any, onPush?: () => void): void;
/**
 * Push an error signal
 */
declare function pushError<T>(state: AsyncIteratorState<T>, _iterator: any, err: any, onPush?: () => void): void;

type AsyncIteratorYieldResult<T> = {
    value: T;
    done?: false;
};
type AsyncIteratorResult<T> = AsyncIteratorYieldResult<T> | {
    value: undefined;
    done: true;
};
/**
 * Creates a factory that produces fresh `AsyncIterator` instances backed by
 * an internal queue with producer-backpressure.
 *
 * The `register` callback receives an `Observer<T>` whose `next()`/`complete()`/
 * `error()` methods push into the iterator's queue. `next()` returns a
 * `Promise<void>` (or `void`) — the promise acts as a backpressure signal
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
 * Each call of the returned factory function creates an independent iterator
 * with its own buffer and subscription.
 *
 * @template T Value type.
 * @param opts Registration function and lazy mode.
 * @returns A function that creates a fresh AsyncIterator per call.
 */
declare function createAsyncIterator<T>(opts: {
    register: (receiver: Receiver<T>) => Subscription;
    conflate?: boolean;
}): () => AsyncIterator<T, undefined, undefined> & {
    __tryNext?: () => AsyncIteratorResult<T> | null;
    __hasBufferedValues?: () => boolean;
    __onPush?: () => void;
    __pushNext?: (value: T) => void;
    __pushComplete?: () => void;
    __pushError?: (err: any) => void;
};

export { AsyncIteratorState, DONE, EMPTY, NEXT, asyncPull, audit, buffer, bufferCount, bufferUntil, bufferWhile, catchError, combineLatest, commit, concat, concatMap, createAsyncCoordinator, createAsyncIterator, createAsyncPushable, createBehaviorSubject, createLock, createOperator, createPushOperator, createQueue, createReceiver, createReplaySubject, createSemaphore, createStream, createSubject, createSubscription, debounce, defaultIfEmpty, defer, delay, delayUntil, delayWhile, distinctUntilChanged, distinctUntilKeyChanged, eachValueFrom, empty, endWith, exhaustMap, expand, filter, finalize, first, firstValueFrom, fork, forkJoin, from, fromAny, fromEvent, fromPromise, getIterator, groupBy, ignoreElements, iif, interval, isOperator, isPromiseLike, isStreamLike, last, lastValueFrom, loop, map, merge, mergeMap, normalizeError, observeOn, of, partition, pipeSourceThrough, pushComplete, pushError, pushValue, race, raceNext, range, reduce, retry, sample, scan, select, share, shareReplay, skip, skipUntil, skipWhile, slidingPair, startWith, streamToArray, switchMap, syncPull, take, takeUntil, takeWhile, tap, throttle, throwError, timer, toArray, withLatestFrom, zip };
export type { AsyncCoordinator, AsyncCoordinatorOptions, AsyncIteratorResult, AsyncIteratorYieldResult, AsyncPushable, BehaviorSubject, ExpandOptions, ForkOption, GroupItem, MaybePromise, Operator, OperatorChain, PendingError, PipeResult, QueueItem, Receiver, ReleaseFn, ReplaySubject, RunnerEvent, Semaphore, SimpleLock, Stream, StrictReceiver, Subject, Subscription, ValidateChain };
