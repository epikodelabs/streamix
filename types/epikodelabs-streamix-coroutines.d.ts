/**
 * Thrown when sending to or receiving from a closed channel.
 */
declare class ChannelClosedError extends Error {
    constructor(message?: string);
}
/**
 * Result of a channel receive operation.
 * `ok: true` when a value was available, `ok: false` when the channel is closed and empty.
 */
type ReceiveResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    value: undefined;
};
/**
 * Internal symbol used by `select(...)` to access atomic wait-list hooks on a channel.
 *
 * This is exported so `select.ts` can coordinate with the channel implementation,
 * but it is not part of the normal end-user API surface.
 *
 * @internal
 */
declare const CHANNEL_INTERNALS: unique symbol;
/**
 * An async channel for passing values between concurrent operations.
 *
 * - `capacity = 0` creates an unbuffered channel (send blocks until receive is ready).
 * - `capacity > 0` creates a buffered channel (send succeeds while buffer has space).
 *
 * Channels are async iterables; use `for await...of` to consume values until closed.
 */
type Channel<T> = AsyncIterable<T> & {
    /** Maximum number of values that can be buffered. */
    readonly capacity: number;
    /** Current number of buffered values. */
    readonly size: number;
    /** Whether the channel has been closed. */
    readonly closed: boolean;
    /** Sends a value. Blocks if the channel is unbuffered and no receiver is waiting, or if the buffer is full. Rejects if the channel is closed. */
    send(value: T, signal?: AbortSignal): Promise<void>;
    /** Receives a value. Returns the value directly, or `undefined` when the channel is closed. Blocks if the channel is empty. */
    receive(signal?: AbortSignal): Promise<T | undefined>;
    /** Non-blocking send. Returns `true` if the value was accepted immediately. */
    trySend(value: T): boolean;
    /** Non-blocking receive. Returns the result immediately, or `undefined` if nothing is available. */
    tryReceive(): ReceiveResult<T> | undefined;
    /** Closes the channel. Pending receivers resolve with `{ ok: false }`; pending senders reject. */
    close(): void;
};
/**
 * Creates a new async channel with the given buffer capacity.
 *
 * @param capacity - Buffer size. `0` means unbuffered (hand-off semantics). Must be a non-negative integer.
 * @returns A new channel.
 */
declare function channel<T>(capacity?: number): Channel<T>;

/**
 * Task descriptor ready to be baked into a worker blob.
 *
 * `main` and `functions` are the single source of truth.
 * String forms are derived on demand via `serializeScript()`.
 */
interface CoroutineScript<T = any, R = any> {
    /** Raw worker-side snippets injected before the serialized functions. */
    helpers?: string[];
    /** Main task body executed inside the worker. */
    main: (data: T) => R | Promise<R>;
    /** Additional named helper functions serialized alongside `main`. */
    functions?: Function[];
}
/**
 * Base contract for anything that can process a task and be finalized.
 */
interface TaskRunner<T = any, R = any> {
    /** Submits one value for worker-side processing. */
    processTask: (data: T) => Promise<R>;
    /** Terminates the underlying worker resources. */
    finalize: () => Promise<void>;
}
/**
 * Plain background-task runner backed by one dedicated worker.
 *
 * Created by `coroutine(mainTask)` and accepted by `compose(...)`.
 */
interface Coroutine<T = any, R = T> extends TaskRunner<T, R> {
}
/**
 * Long-lived stateful worker with bidirectional messaging.
 *
 * `Actor` is an opaque handle to a persistent behavior loop running in a
 * dedicated worker. Messaging is done through the `main` utility:
 * `main.outbox.send(actorOrName, topic, msg)`, `main.outbox.request(actorOrName, topic, msg)`,
 * and `main.inbox.subscribe(handler)`.
 *
 * Lifecycle is managed through the bus — call `main.outbox.stop(actorOrName)`
 * to stop the actor and release resources.
 *
 * Unlike `Coroutine`, an actor owns exactly one worker.
 */
interface Actor {
    /** Stable actor name used for actor-to-actor addressing. */
    readonly name: string;
    /** `true` while the behavior loop is running. */
    readonly running: boolean;
}

/**
 * Chains multiple coroutines sequentially into a single `Coroutine`.
 *
 * `CoroutineScript` inputs (created by `coroutine()`) are merged into one
 * worker script so the entire pipeline runs inside one dedicated worker task.
 *
 * `TaskRunner` inputs are chained in the main thread after the worker
 * stage completes.
 */
declare function compose<A, B>(...scripts: [CoroutineScript<A, B>]): Coroutine<A, B>;
declare function compose<A, B, C>(...scripts: [CoroutineScript<A, B>, CoroutineScript<B, C>]): Coroutine<A, C>;
declare function compose<A, B, C, D>(...scripts: [CoroutineScript<A, B>, CoroutineScript<B, C>, CoroutineScript<C, D>]): Coroutine<A, D>;
declare function compose<T = any, R = any>(...scripts: Array<CoroutineScript<any, any> | TaskRunner<any, any>>): Coroutine<T, R>;

/**
 * Thrown when a context is cancelled or times out.
 */
declare class ContextCancelledError extends Error {
    constructor(message?: string);
}
/**
 * A cancellation context inspired by Go's `context.Context`.
 *
 * Carries an `AbortSignal`, a `done` promise, cancellation reason,
 * and an optional key/value bag for request-scoped data.
 */
type Context = {
    /** Abort signal that becomes aborted when the context is cancelled. */
    readonly signal: AbortSignal;
    /** Promise that resolves when the context is cancelled. */
    readonly done: Promise<void>;
    /** The cancellation reason, if any. */
    readonly reason: unknown;
    /** Retrieves a value stored in the context by key. */
    value<T = unknown>(key: unknown): T | undefined;
    /** Returns a child context with an additional key/value pair. */
    withValue<T = unknown>(key: unknown, value: T): Context;
};
/**
 * Function that cancels a context, optionally supplying a reason.
 */
type Cancel = (reason?: unknown) => void;
/**
 * Creates an abort error from an `AbortSignal`'s reason.
 *
 * @param signal The abort signal to extract the reason from.
 * @returns An `Error` instance representing the abort reason.
 */
declare const createAbortError: (signal?: AbortSignal) => Error;
/**
 * Creates a root context that is not derived from any parent.
 *
 * @returns A new background `Context`.
 */
declare const background: () => Context;
/**
 * Derives a cancellable child context from a parent.
 *
 * The child is automatically cancelled when the parent is cancelled.
 *
 * @param parent The parent context. Defaults to `background()`.
 * @returns A tuple of `[childContext, cancel]`.
 */
declare function withCancel(parent?: Context): [Context, Cancel];
/**
 * Derives a child context that automatically cancels after a timeout.
 *
 * @param parent The parent context.
 * @param ms Timeout in milliseconds.
 * @returns A tuple of `[childContext, cancel]`.
 */
declare function withTimeout(parent: Context, ms: number): [Context, Cancel];
/**
 * Derives a child context that automatically cancels at a specific deadline.
 *
 * @param parent The parent context.
 * @param deadline A `Date` or timestamp (in milliseconds) when the context should cancel.
 * @returns A tuple of `[childContext, cancel]`.
 */
declare function withDeadline(parent: Context, deadline: Date | number): [Context, Cancel];

/**
 * Internal outcome payload used when a registered `select(...)` case wins.
 *
 * The outer `select(...)` call maps this low-level result back into the public
 * `SelectResult` shape.
 *
 * @internal
 */
type SelectOutcome<T> = {
    index: number;
    caseRef: unknown;
    op: "receive" | "send";
    name?: string;
    value?: T;
    ok?: boolean;
};
/**
 * Internal select registration shared between `channel(...)` and `select(...)`.
 *
 * A registration owns the winner/loser state for one `select(...)` call so the
 * channel can settle exactly one branch atomically.
 *
 * @internal
 */
type SelectRegistration<T> = {
    id: symbol;
    isSettled: () => boolean;
    settle: (outcome: SelectOutcome<T>) => boolean;
    reject: (error: Error) => boolean;
};
/**
 * Internal metadata carried with each registered channel case.
 *
 * @internal
 */
type SelectCaseMeta = {
    index: number;
    caseRef: unknown;
    name?: string;
};
/**
 * Internal hooks exposed by a channel so `select(...)` can register atomic send
 * and receive contenders directly against the waiting queues.
 *
 * @internal
 */
type ChannelSelectInternals<T> = {
    registerSelectReceive: (registration: SelectRegistration<T>, meta: SelectCaseMeta) => () => void;
    registerSelectSend: (value: T, registration: SelectRegistration<T>, meta: SelectCaseMeta) => () => void;
};
/**
 * Represents a `select` case that receives a value from a channel.
 *
 * @template T The type of value received from the channel.
 */
type SelectReceiveCase<T = any> = {
    op: "receive";
    channel: Channel<T>;
    name?: string;
};
/**
 * Represents a `select` case that sends a value into a channel.
 *
 * @template T The type of value sent to the channel.
 */
type SelectSendCase<T = any> = {
    op: "send";
    channel: Channel<T>;
    value: T;
    name?: string;
};
/**
 * Represents a default `select` case that fires when no other case is ready.
 */
type SelectDefaultCase = {
    op: "default";
    name?: string;
};
/**
 * A union of all possible `select` cases.
 *
 * @template T The channel value type.
 */
type SelectCase<T = any> = SelectReceiveCase<T> | SelectSendCase<T> | SelectDefaultCase;
/**
 * Result of a `select` operation indicating which case was chosen.
 *
 * @template T The channel value type.
 */
type SelectResult<T = any> = {
    index: number;
    case: SelectCase<T>;
    op: SelectCase<T>["op"];
    name?: string;
    value?: T;
    ok?: boolean;
};
/**
 * Builds a receive case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to receive from.
 * @param name Optional identifier for this case.
 * @returns A `SelectReceiveCase`.
 */
declare const receive: <T>(ch: Channel<T>, name?: string) => SelectReceiveCase<T>;
/**
 * Builds a send case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to send into.
 * @param value The value to send.
 * @param name Optional identifier for this case.
 * @returns A `SelectSendCase`.
 */
declare const send: <T>(ch: Channel<T>, value: T, name?: string) => SelectSendCase<T>;
/**
 * Builds a default case for use with `select(...)`.
 *
 * @param name Optional identifier for this case.
 * @returns A `SelectDefaultCase`.
 */
declare const otherwise: (name?: string) => SelectDefaultCase;
declare function select<T = any>(cases: SelectCase<T>[], ctx?: Context): Promise<SelectResult<T>>;

/**
 * Concurrency utils injected into actor workers.
 *
 * These are the worker-side coroutine primitives available inside
 * `actor((msg, state, utils) => ...)`.
 *
 * They mirror the standalone concurrency API, but are pre-injected into the
 * actor worker so behaviors can coordinate background tasks without importing
 * anything from the main thread.
 *
 * - `channel(capacity?)`: create a worker-local async channel
 * - `receive(ch, name?)` / `send(ch, value, name?)`: build `select(...)` cases
 * - `otherwise(name?)`: default `select(...)` branch
 * - `select(cases, ctx?)`: race channel operations fairly
 * - `background()`: root cancellation context
 * - `withCancel/withTimeout/withDeadline(...)`: derive cancellable contexts
 * - `ChannelClosedError` / `ContextCancelledError`: worker-side error classes
 */
type WorkerConcurrency = {
    channel: typeof channel;
    receive: typeof receive;
    send: typeof send;
    otherwise: typeof otherwise;
    select: typeof select;
    background: typeof background;
    withCancel: typeof withCancel;
    withTimeout: typeof withTimeout;
    withDeadline: typeof withDeadline;
    ChannelClosedError: typeof ChannelClosedError;
    ContextCancelledError: typeof ContextCancelledError;
};
/**
 * Outbox API exposed to actor workers.
 *
 * This handles targeted requests plus direct sends.
 */
type WorkerOutbox<Q = any, D = any> = {
    /** Sends a request to one named target and awaits a response. Use `"main"` for the source actor's main-thread side. */
    request: (to: ActorBusTarget, topic: string, payload: Q) => Promise<D>;
    /** Sends a direct bus message to one or more named actor targets. */
    send: <T = any>(to: ActorBusTarget, topic: string, payload: T) => void;
};
/**
 * Inbox API for receiving messages routed to the actor worker.
 *
 * This includes direct messages from `main.outbox.send(...)` as well as actor-bus
 * deliveries routed through `main.bus`.
 */
type WorkerInbox<Incoming = any> = {
    /** Receives the next message routed to this actor, or `undefined` if the inbox closes. */
    listen: (signal?: AbortSignal) => Promise<Incoming | undefined>;
};
/**
 * Actor-bus delivery target.
 */
type ActorBusTarget = string | string[];
/**
 * Main-thread communication interface.
 *
 * `Initiator` describes the public shape of `main` so that consumers can
 * reference it explicitly rather than deriving it via `typeof main`.
 */
interface Initiator {
    outbox: {
        /** Broadcasts a topic payload to every named actor through the actor bus. */
        publish<T = any>(topic: string, payload: T, options?: ActorBusDispatchOptions): void;
        /** Sends a one-way bus message to one or more named actor targets. */
        send<T = any>(to: Actor | string | string[], topic: string, payload: T, options?: Pick<ActorBusDispatchOptions, "from">): void;
        /** Sends a request to an actor and awaits the response. */
        request<Q = any, D = any>(to: Actor | string, topic: string, payload: Q): Promise<D>;
        /** Stops the actor, terminates its worker, and releases resources. */
        stop(actor: Actor | string): Promise<void>;
    };
    inbox: {
        /** Subscribes to all actor-bus messages. */
        subscribe(handler: ActorBusHandler): () => void;
        /** Clears all global and direct bus listeners. */
        clear(): void;
    };
}
/** Sender name stamped onto actor-bus messages. */
type ActorBusSender = string;
/**
 * Structured bus envelope exchanged between actors through a main-thread bus.
 */
type ActorBusMessage<T = any> = {
    kind: "actor-bus";
    topic: string;
    payload: T;
    from?: ActorBusSender;
    to?: ActorBusTarget;
};
/**
 * Dispatch options for main-thread actor-bus publishing.
 */
type ActorBusDispatchOptions = {
    /**
     * Stable sender name to stamp onto the routed message.
     */
    from?: ActorBusSender;
    /**
     * Includes the sender during broadcast delivery when `from` is set.
     */
    includeSelf?: boolean;
};
/**
 * Main-thread subscriber invoked for each routed bus envelope.
 */
type ActorBusHandler<T = any> = (message: ActorBusMessage<T>) => void | Promise<void>;
/**
 * Main-thread actor bus integrated into the actor messaging surface.
 *
 * Workers send direct messages through `utils.outbox.send(to, topic, payload)`,
 * while the main thread can publish or send through `main.bus`.
 */
interface ActorBus {
    /**
     * Broadcasts a topic payload to every actor.
     */
    publish: <T = any>(topic: string, payload: T, options?: ActorBusDispatchOptions) => void;
    /**
     * Sends a topic payload to one or more explicit actor names.
     */
    send: <T = any>(to: ActorBusTarget, topic: string, payload: T, options?: Pick<ActorBusDispatchOptions, "from">) => void;
    /**
     * Routes a prebuilt actor-bus envelope.
     */
    dispatch: <T = any>(message: ActorBusMessage<T>, options?: Pick<ActorBusDispatchOptions, "includeSelf">) => void;
    /**
     * Listens to all routed bus envelopes, or only to direct messages sent to a name.
     */
    listen: {
        <T = any>(handler: ActorBusHandler<T>): () => void;
        <T = any>(name: string, handler: ActorBusHandler<T>): () => void;
    };
    /**
     * Clears all actor registrations and listeners from the integrated bus.
     */
    clear: () => void;
}
/**
 * Utility functions available to actor workers.
 */
type WorkerUtilsCompatibility<_T> = {};
type WorkerUtils<Q = any, D = any, Incoming = any, ToMain = any> = {
    concurrency: WorkerConcurrency;
    outbox: WorkerOutbox<Q, D>;
    inbox: WorkerInbox<Incoming>;
} & WorkerUtilsCompatibility<ToMain>;
/**
 * Actor behavior signature for autonomous entity mode.
 *
 * Receives a message, the current state, and worker utilities.
 * Returns the new state (or a Promise resolving to it).
 */
interface ActorBehavior<S = any, Q = any, D = any, Incoming = any> {
    (msg: Incoming, state: S, utils: WorkerUtils<Q, D, Incoming>): Promise<S> | S;
}
/**
 * Public request/message metadata surfaced to advanced actor hooks.
 *
 * This intentionally exposes routing information rather than the full internal
 * worker protocol.
 */
type ActorMessageContext = {
    /** Actor name that initiated the request or direct message, when known. */
    from?: string;
    /** Target name(s) for direct actor routing. */
    to?: ActorBusTarget;
    /** Topic associated with the routed request or message. */
    topic?: string;
};
/**
 * Request handler used by `utils.outbox.request(name, topic, payload)`.
 *
 * Keep this function small, or delegate to a `coroutine(...)` instance via
 * `request: dataWorker.processTask` when data resolution itself is expensive.
 */
type ActorRequestHandler<Q = any, D = any> = (topic: string, request: Q, message: ActorMessageContext) => Promise<D> | D;
/**
 * Registers a main-thread request handler for a target actor name.
 * Workers call `utils.outbox.request(name, topic, payload)` — the handler
 * registered for `name` receives the call and returns the response.
 *
 * Register `"main"` to handle requests sent to the main thread.
 */
declare function registerActorRequestHandler<Q = any, D = any>(name: string, handler: ActorRequestHandler<Q, D>): () => void;
/**
 * Removes a request handler previously registered for a name.
 */
declare function unregisterActorRequestHandler(name: string): void;
/**
 * Creates a typed actor-bus envelope.
 */
declare function createActorBusMessage<T = any>(topic: string, payload: T, options?: {
    from?: string;
    to?: ActorBusTarget;
}): ActorBusMessage<T>;
/**
 * Checks whether a payload is an actor-bus envelope.
 */
declare function isActorBusMessage<T = any>(value: unknown): value is ActorBusMessage<T>;
/**
 * Creates an autonomous behavior-mode actor.
 *
 * `actor(behavior, ...helpers)` returns a factory function that accepts
 * a stable actor name plus `initialState` and eagerly creates the worker.
 *
 * @example
 * ```ts
 * const counter = actor("counter", (msg, state, utils) => state + msg.payload.n, 0);
 * main.outbox.send(counter, "inc", { n: 1 });
 * const value = await main.outbox.request(counter, "inc", { n: 2 });
 * ```
 */
declare function actor<S = any, Q = any, D = any, FromMain = any>(name: string, behavior: ActorBehavior<S, Q, D, FromMain>, initialState?: S, ...helpers: (Function | string)[]): Actor;
declare const main: Initiator;

/**
 * Task function executed inside a worker without actor utilities.
 */
type CoroutineTask<T = any, R = any> = (data: T) => Promise<R> | R;
/**
 * Optional settings for plain one-way coroutine workers.
 */
type CoroutineOptions = {
    /** Raw helper snippets injected into the worker before task code. */
    helpers?: string[];
};
type CoroutineDefinitionRest = Function[] | [...Function[], CoroutineOptions];
/**
 * Creates a reusable coroutine task runner with its worker script baked once.
 *
 * A coroutine owns one dedicated worker, reuses it across calls, and queues
 * `processTask()` submissions on that worker. The returned `Coroutine` can be
 * used with `.pipe()` in stream pipelines or called directly. Call
 * `.finalize()` when done to terminate the underlying worker. Raw helper
 * snippets can be provided through an optional trailing options object.
 */
declare function coroutine<T, R>(main: CoroutineTask<T, R>, ...rest: CoroutineDefinitionRest): Coroutine<T, R> & CoroutineScript<T, R>;

/**
 * Callable pooled compute handle returned by `compute()`.
 */
interface ComputeRunner<T = any, R = any> {
    /** Submits input to the compute pool and resolves with the worker result. */
    (params: T | Promise<T>): Promise<R>;
    /** Terminates all workers in the pool and rejects queued work. */
    finalize: () => Promise<void>;
}
/**
 * Offloads a function to a dedicated worker pool.
 *
 * `compute` creates a specialized reusable pool: the task is baked into the
 * worker blob once and shared by every worker in the pool. There is no
 * runtime compilation overhead; workers are pre-initialized with the task.
 *
 * The returned async function submits params to that pool. The pool lives
 * for as long as the function exists. Call `.finalize()` when done to
 * terminate the underlying workers.
 *
 * @example
 * ```ts
 * const run = compute((x: number) => x * 2);
 * const result = await run(5); // 10
 * await run.finalize();
 * ```
 */
declare function compute<T = any, R = any>(main: (data: T) => R | Promise<R>, ...functions: Function[]): ComputeRunner<T, R>;
/**
 * Creates a compute runner from an existing `CoroutineScript`.
 *
 * This is useful when a script should be pooled for throughput instead of run
 * through `coroutine()`'s single dedicated worker.
 */
declare function computeScript<T = any, R = any>(script: CoroutineScript<T, R>): ComputeRunner<T, R>;

export { CHANNEL_INTERNALS, ChannelClosedError, ContextCancelledError, actor, background, channel, compose, compute, computeScript, coroutine, createAbortError, createActorBusMessage, isActorBusMessage, main, otherwise, receive, registerActorRequestHandler, select, send, unregisterActorRequestHandler, withCancel, withDeadline, withTimeout };
export type { ActorBehavior, ActorBus, ActorBusDispatchOptions, ActorBusHandler, ActorBusMessage, ActorBusSender, ActorBusTarget, ActorMessageContext, ActorRequestHandler, Cancel, Channel, ChannelSelectInternals, ComputeRunner, Context, CoroutineOptions, CoroutineScript, CoroutineTask, Initiator, ReceiveResult, SelectCase, SelectCaseMeta, SelectDefaultCase, SelectOutcome, SelectReceiveCase, SelectRegistration, SelectResult, SelectSendCase, WorkerConcurrency, WorkerInbox, WorkerOutbox, WorkerUtils };
