import {
  background,
  channel,
  ChannelClosedError,
  ContextCancelledError,
  otherwise,
  receive,
  select,
  send,
  withCancel,
  withDeadline,
  withTimeout,
  type Channel,
} from "../utils";
import type {
  WorkerProtocolHandler,
  WorkerProtocolMessage,
} from "../worker/messages";
import { acquireBlobUrl, releaseBlobUrl } from "../worker/blob";
import { buildActorWorkerRuntime } from "../worker/runtimes";
import { buildWorkerScript } from "../worker/script";
import type { Actor } from "../worker/types";

/**
 * Concurrency utils injected into actor workers.
 *
 * Provides channel operations, context control, and select helpers
 * that mirror the main-thread API but run inside the worker scope.
 */
export type WorkerConcurrency = {
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
 * Outbox API for sending messages from the worker to the main thread.
 */
export type WorkerOutbox<Q = any, D = any, ToMain = any> = {
  /** Sends a one-way message to the main thread. */
  send: (payload: ToMain) => void;
  /** Sends a request to the main thread and awaits a response. */
  request: (payload: Q) => Promise<D>;
};

/**
 * Inbox API for receiving messages from the main thread in the worker.
 */
export type WorkerInbox<FromMain = any> = {
  /** Receives a message from the main thread, or `undefined` if the inbox closes. */
  receive: (signal?: AbortSignal) => Promise<FromMain | undefined>;
  /** The worker's inbox channel for messages from the main thread. */
  channel: Channel<FromMain>;
};

/**
 * Utility functions available to actor workers.
 */
export type WorkerUtils<Q = any, D = any, FromMain = any, ToMain = any> = {
  concurrency: WorkerConcurrency;
  outbox: WorkerOutbox<Q, D, ToMain>;
  inbox: WorkerInbox<FromMain>;
};

/**
 * Actor behavior signature for autonomous entity mode.
 *
 * Receives a message, the current state, and worker utilities.
 * Returns the new state (or a Promise resolving to it).
 */
export interface ActorBehavior<S = any, Q = any, D = any, FromMain = any, ToMain = any> {
  (msg: FromMain, state: S, utils: WorkerUtils<Q, D, FromMain, ToMain>): Promise<S> | S;
}

/**
 * Metadata describing the protocol envelope around an actor message.
 *
 * This is surfaced to advanced handlers without exposing the full internal
 * worker-pool protocol as part of the main public API.
 */
export type ActorMessageContext = Pick<
  WorkerProtocolMessage,
  "workerId" | "taskId" | "requestId"
>;

/**
 * Request handler used by `utils.outbox.request()`.
 *
 * Keep this function small, or delegate to a `coroutine(...)` instance via
 * `request: dataWorker.processTask` when data resolution itself is expensive.
 */
export type ActorRequestHandler<Q = any, D = any> = (
  request: Q,
  message: ActorMessageContext
) => Promise<D> | D;

/**
 * Configuration for actor workers that use the default message handler.
 *
 * `request` resolves `utils.outbox.request(payload)` calls initiated from inside
 * the worker. `onMessage` receives one-way `utils.outbox.send(payload)` traffic.
 */
export type ActorConfig<Q = any, D = any, ToMain = any> = {
  helpers?: string[];
  onRequest?: ActorRequestHandler<Q, D>;
  onMessage?: (payload: ToMain, message: ActorMessageContext) => void | Promise<void>;
};

/**
 * Alternative configuration that replaces the entire main-thread message
 * handler. When this is used, `onRequest` and `onMessage` are ignored.
 */
export type ActorCustomMessageHandlerConfig = {
  helpers?: string[];
  customMessageHandler: ActorProtocolHandler;
};

/**
 * Escape hatch for advanced actor integrations that need the raw worker
 * protocol instead of the higher-level `onRequest` / `onMessage` hooks.
 */
export type ActorProtocolHandler = WorkerProtocolHandler;

const ACTOR_CONCURRENCY_RUNTIME = `
class __streamixChannelClosedError extends Error {
  constructor(message = "channel is closed") {
    super(message);
    this.name = "ChannelClosedError";
  }
}

class __streamixContextCancelledError extends Error {
  constructor(message = "context cancelled") {
    super(message);
    this.name = "ContextCancelledError";
  }
}

const __streamixCreateAbortError = (signal) => {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new __streamixContextCancelledError(reason ? String(reason) : undefined);
};

const __streamixChannelInternals = Symbol("streamix.channelInternals");

const __streamixChannel = (capacity = 0) => {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError("channel capacity must be a non-negative integer");
  }

  const buffer = [];
  const receivers = [];
  const senders = [];
  let isClosed = false;

  const cleanupReceiver = (receiver) => {
    if (receiver.signal && receiver.abort) {
      receiver.signal.removeEventListener("abort", receiver.abort);
    }
  };

  const cleanupSender = (sender) => {
    if (sender.signal && sender.abort) {
      sender.signal.removeEventListener("abort", sender.abort);
    }
  };

  const removeReceiver = (receiver) => {
    const index = receivers.indexOf(receiver);
    if (index >= 0) receivers.splice(index, 1);
    cleanupReceiver(receiver);
  };

  const removeSender = (sender) => {
    const index = senders.indexOf(sender);
    if (index >= 0) senders.splice(index, 1);
    cleanupSender(sender);
  };

  const settleSelectedReceive = (receiver, value, ok) =>
    receiver.select.registration.settle({
      index: receiver.select.meta.index,
      caseRef: receiver.select.meta.caseRef,
      op: "receive",
      name: receiver.select.meta.name,
      value,
      ok,
    });

  const settleSelectedSend = (sender) =>
    sender.select.registration.settle({
      index: sender.select.meta.index,
      caseRef: sender.select.meta.caseRef,
      op: "send",
      name: sender.select.meta.name,
      ok: true,
    });

  const rejectSelectedWaiter = (waiter, error) =>
    waiter.select.registration.reject(error);

  const tryDispatchToWaitingReceiver = (value, senderSelectId) => {
    for (let index = 0; index < receivers.length; index++) {
      const receiver = receivers[index];
      const receiverSelectId = receiver.select?.registration.id;

      if (receiver.select?.registration.isSettled()) {
        receivers.splice(index, 1);
        cleanupReceiver(receiver);
        index -= 1;
        continue;
      }

      if (senderSelectId && receiverSelectId === senderSelectId) {
        continue;
      }

      receivers.splice(index, 1);
      cleanupReceiver(receiver);

      if (receiver.select) {
        if (!settleSelectedReceive(receiver, value, true)) {
          index -= 1;
          continue;
        }
      } else {
        receiver.resolve({ ok: true, value });
      }

      return true;
    }

    return false;
  };

  const tryAcquireFromWaitingSender = (receiverSelectId) => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      if (receiverSelectId && senderSelectId === receiverSelectId) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      return { ok: true, value: sender.value };
    }

    if (isClosed) {
      return { ok: false, value: undefined };
    }

    return undefined;
  };

  const tryBufferWaitingSender = () => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      buffer.push(sender.value);
      return true;
    }

    return false;
  };

  const tryPairWaitingSenderToReceiver = () => {
    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index];
      const senderSelectId = sender.select?.registration.id;

      if (sender.select?.registration.isSettled()) {
        senders.splice(index, 1);
        cleanupSender(sender);
        index -= 1;
        continue;
      }

      if (!tryDispatchToWaitingReceiver(sender.value, senderSelectId)) {
        continue;
      }

      senders.splice(index, 1);
      cleanupSender(sender);

      if (sender.select) {
        if (!settleSelectedSend(sender)) {
          index -= 1;
          continue;
        }
      } else {
        sender.resolve();
      }

      return true;
    }

    return false;
  };

  const flushSenders = () => {
    while (senders.length > 0) {
      if (receivers.length > 0) {
        if (!tryPairWaitingSenderToReceiver()) {
          break;
        }
        continue;
      }

      if (capacity > 0 && buffer.length < capacity) {
        if (!tryBufferWaitingSender()) {
          break;
        }
        continue;
      }

      break;
    }
  };

  const sendValue = (value, signal) => {
    if (isClosed) return Promise.reject(new __streamixChannelClosedError());
    if (signal?.aborted) return Promise.reject(__streamixCreateAbortError(signal));

    if (tryDispatchToWaitingReceiver(value)) {
      return Promise.resolve();
    }

    if (capacity > 0 && buffer.length < capacity) {
      buffer.push(value);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const sender = { value, resolve, reject, signal };
      if (signal) {
        sender.abort = () => {
          removeSender(sender);
          reject(__streamixCreateAbortError(signal));
        };
        signal.addEventListener("abort", sender.abort, { once: true });
      }
      senders.push(sender);
    });
  };

  const receiveValue = (signal) => {
    if (buffer.length > 0) {
      const value = buffer.shift();
      flushSenders();
      return Promise.resolve({ ok: true, value });
    }

    const matchedSender = tryAcquireFromWaitingSender();
    if (matchedSender) {
      return Promise.resolve(matchedSender);
    }

    if (isClosed) {
      return Promise.resolve({ ok: false, value: undefined });
    }

    if (signal?.aborted) return Promise.reject(__streamixCreateAbortError(signal));

    return new Promise((resolve, reject) => {
      const receiver = { resolve, reject, signal };
      if (signal) {
        receiver.abort = () => {
          removeReceiver(receiver);
          reject(__streamixCreateAbortError(signal));
        };
        signal.addEventListener("abort", receiver.abort, { once: true });
      }
      receivers.push(receiver);
    });
  };

  return {
    get capacity() {
      return capacity;
    },
    get size() {
      return buffer.length;
    },
    get closed() {
      return isClosed;
    },
    send: sendValue,
    async receive(signal) {
      const result = await receiveValue(signal);
      return result.ok ? result.value : undefined;
    },
    trySend(value) {
      if (isClosed) return false;
      if (tryDispatchToWaitingReceiver(value)) {
        return true;
      }
      if (capacity > 0 && buffer.length < capacity) {
        buffer.push(value);
        return true;
      }
      return false;
    },
    tryReceive() {
      if (buffer.length > 0) {
        const value = buffer.shift();
        flushSenders();
        return { ok: true, value };
      }
      const matchedSender = tryAcquireFromWaitingSender();
      if (matchedSender) {
        return matchedSender;
      }
      if (isClosed) return { ok: false, value: undefined };
      return undefined;
    },
    close() {
      if (isClosed) return;
      isClosed = true;

      while (receivers.length > 0) {
        const receiver = receivers.shift();
        cleanupReceiver(receiver);
        if (receiver.select) {
          settleSelectedReceive(receiver, undefined, false);
        } else {
          receiver.resolve({ ok: false, value: undefined });
        }
      }

      while (senders.length > 0) {
        const sender = senders.shift();
        cleanupSender(sender);
        const error = new __streamixChannelClosedError();
        if (sender.select) {
          rejectSelectedWaiter(sender, error);
        } else {
          sender.reject(error);
        }
      }
    },
    [__streamixChannelInternals]: {
      registerSelectReceive(registration, meta) {
        const receiver = {
          resolve() {},
          reject() {},
          select: { registration, meta },
        };
        receivers.push(receiver);
        return () => removeReceiver(receiver);
      },
      registerSelectSend(value, registration, meta) {
        if (isClosed) {
          registration.reject(new __streamixChannelClosedError());
          return () => {};
        }

        const sender = {
          value,
          resolve() {},
          reject() {},
          select: { registration, meta },
        };
        senders.push(sender);
        return () => removeSender(sender);
      },
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        const item = await receiveValue();
        if (!item.ok) return;
        yield item.value;
      }
    },
  };
};

const __streamixCreateContextFromState = (state) => {
  const done = new Promise((resolve) => {
    if (state.controller.signal.aborted) {
      resolve();
    } else {
      state.controller.signal.addEventListener("abort", () => resolve(), { once: true });
    }
  });

  return {
    get signal() {
      return state.controller.signal;
    },
    done,
    get reason() {
      return state.controller.signal.reason;
    },
    value(key) {
      if (state.values.has(key)) return state.values.get(key);
      return state.parent?.value(key);
    },
    withValue(key, value) {
      const values = new Map();
      values.set(key, value);
      return __streamixCreateContextFromState({
        controller: state.controller,
        values,
        parent: this,
      });
    },
  };
};

const __streamixBackground = () =>
  __streamixCreateContextFromState({ controller: new AbortController(), values: new Map() });

const __streamixWithCancel = (parent = __streamixBackground()) => {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent.reason ?? new __streamixContextCancelledError());

  if (parent.signal.aborted) {
    onParentAbort();
  } else {
    parent.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const ctx = __streamixCreateContextFromState({ controller, values: new Map(), parent });
  const cancel = (reason = new __streamixContextCancelledError()) => {
    parent.signal.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(reason);
  };

  return [ctx, cancel];
};

const __streamixWithTimeout = (parent, ms) => {
  const [ctx, cancel] = __streamixWithCancel(parent);
  const timer = setTimeout(() => cancel(new __streamixContextCancelledError("context timeout after " + ms + "ms")), ms);
  ctx.done.finally(() => clearTimeout(timer));
  return [ctx, cancel];
};

const __streamixWithDeadline = (parent, deadline) => {
  const time = typeof deadline === "number" ? deadline : deadline.getTime();
  return __streamixWithTimeout(parent, Math.max(0, time - Date.now()));
};

const __streamixRecv = (ch, name) => ({ op: "receive", channel: ch, name });
const __streamixSend = (ch, value, name) => ({ op: "send", channel: ch, value, name });
const __streamixOtherwise = (name = "default") => ({ op: "default", name });

const __streamixShuffledIndices = (length) => {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
};

const __streamixSelect = async (cases, ctx = __streamixBackground()) => {
  if (ctx.signal.aborted) throw __streamixCreateAbortError(ctx.signal);

  const defaultIndex = cases.findIndex((item) => item.op === "default");
  const channelIndices = cases
    .map((_, i) => i)
    .filter((i) => cases[i].op !== "default");
  const randomOrder = __streamixShuffledIndices(channelIndices.length).map((j) => channelIndices[j]);

  for (const index of randomOrder) {
    const item = cases[index];
    if (item.op === "receive") {
      const result = item.channel.tryReceive();
      if (result) {
        return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
      }
    } else if (item.op === "send") {
      if (item.channel.closed) {
        throw new __streamixChannelClosedError();
      }
      if (item.channel.trySend(item.value)) {
        return { index, case: item, op: item.op, name: item.name, ok: true };
      }
    }
  }

  if (defaultIndex >= 0) {
    const item = cases[defaultIndex];
    return { index: defaultIndex, case: item, op: item.op, name: item.name, ok: true };
  }

  const selectId = Symbol("streamix.select");
  let settled = false;
  const cleanupFns = [];

  try {
    return await new Promise((resolve, reject) => {
      const registration = {
        id: selectId,
        isSettled: () => settled,
        settle: (outcome) => {
          if (settled) return false;
          settled = true;
          resolve({
            index: outcome.index,
            case: outcome.caseRef,
            op: outcome.op,
            name: outcome.name,
            value: outcome.value,
            ok: outcome.ok,
          });
          return true;
        },
        reject: (error) => {
          if (settled) return false;
          settled = true;
          reject(error);
          return true;
        },
      };

      const onContextAbort = () => {
        registration.reject(__streamixCreateAbortError(ctx.signal));
      };

      ctx.signal.addEventListener("abort", onContextAbort, { once: true });
      cleanupFns.push(() => ctx.signal.removeEventListener("abort", onContextAbort));

      for (const index of randomOrder) {
        if (settled) break;

        const item = cases[index];
        if (item.op === "default") continue;

        const internals = item.channel[__streamixChannelInternals];
        if (!internals) {
          registration.reject(new __streamixContextCancelledError("channel does not support select"));
          break;
        }

        const meta = { index, caseRef: item, name: item.name };
        const unregister =
          item.op === "receive"
            ? internals.registerSelectReceive(registration, meta)
            : internals.registerSelectSend(item.value, registration, meta);

        cleanupFns.push(unregister);
      }
    });
  } finally {
    while (cleanupFns.length > 0) {
      cleanupFns.pop()();
    }
  }
};

const __streamixConcurrency = Object.freeze({
  channel: __streamixChannel,
  receive: __streamixRecv,
  send: __streamixSend,
  otherwise: __streamixOtherwise,
  select: __streamixSelect,
  background: __streamixBackground,
  withCancel: __streamixWithCancel,
  withTimeout: __streamixWithTimeout,
  withDeadline: __streamixWithDeadline,
  ChannelClosedError: __streamixChannelClosedError,
  ContextCancelledError: __streamixContextCancelledError,
});
`;



const ACTOR_TERMINATION_TIMEOUT_MS = 100;
const ACTOR_STOPPED_ERROR_MESSAGE = "Actor stopped";

type PendingActorRequest<S> = {
  resolve: (value: S) => void;
  reject: (error: Error) => void;
};

const toErrorMessage = (
  error: unknown,
  fallback = "Actor request failed"
): string => (error instanceof Error ? error.message : error ? String(error) : fallback);

function postActorResponse(
  worker: Worker,
  message: Pick<WorkerProtocolMessage, "workerId" | "taskId" | "requestId"> &
    ({ type: "response"; payload: unknown } | { type: "error"; error: string })
) {
  worker.postMessage(message);
}

function handleRequest<Q, D>(
  message: WorkerProtocolMessage,
  config: ActorConfig<Q, D, any> | ActorCustomMessageHandlerConfig | undefined,
  worker: Worker
) {
  const { workerId, taskId, requestId, payload } = message;

  if (!config || !("onRequest" in config) || !config.onRequest) {
    postActorResponse(worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: "No actor request handler configured",
    });
    return;
  }

  try {
    const result = config.onRequest(payload as Q, message);
    Promise.resolve(result)
      .then((resolved) => {
        postActorResponse(worker, {
          workerId,
          taskId,
          requestId,
          type: "response",
          payload: resolved,
        });
      })
      .catch((err) => {
        postActorResponse(worker, {
          workerId,
          taskId,
          requestId,
          type: "error",
          error: toErrorMessage(err),
        });
      });
  } catch (err) {
    postActorResponse(worker, {
      workerId,
      taskId,
      requestId,
      type: "error",
      error: toErrorMessage(err),
    });
  }
}

function handleWorkerMessage<ToMain>(
  message: WorkerProtocolMessage,
  config: ActorConfig<any, any, ToMain> | ActorCustomMessageHandlerConfig | undefined,
  messageHandlers: Set<(payload: ToMain) => void>
) {
  const payload = message.payload as ToMain;
  if (config && "onMessage" in config && config.onMessage) {
    Promise.resolve(config.onMessage(payload, message)).catch((err) => {
      console.warn("config.onMessage failed:", err);
    });
  }
  messageHandlers.forEach((h) => {
    try {
      h(payload);
    } catch (err) {
      console.warn("onMessage handler failed:", err);
    }
  });
}

/**
 * Creates an autonomous behavior-mode actor.
 *
 * `actor(behavior, ...helpers)` returns a factory function that accepts
 * `initialState` and eagerly creates the worker.
 *
 * @example
 * ```ts
 * const Counter = actor((msg, state, utils) => state + msg.n);
 * const counter = Counter(0);
 * counter.post({ n: 1 });
 * const value = await counter.request({ n: 2 });
 * ```
 */
export function actor<S = any, Q = any, D = any, ToMain = any, FromMain = any>(
  behavior: ActorBehavior<S, Q, D, FromMain, ToMain>,
  ...functions: Function[]
): (initialState: S) => Actor;
/**
 * Creates a configured autonomous behavior-mode actor.
 *
 * `actor(config)` returns a factory function that accepts
 * `(behavior, ...helpers)` and returns another factory for `initialState`.
 *
 * @example
 * ```ts
 * const Counter = actor({
 *   onRequest: (q) => fetch(q),
 * });
 * const counter = Counter((msg, state) => state + msg)(0);
 * ```
 */
export function actor<Q = any, D = any, ToMain = any>(
  config: ActorConfig<Q, D, ToMain> | ActorCustomMessageHandlerConfig,
): <S = any, FromMain = any>(
  behavior: ActorBehavior<S, Q, D, FromMain, ToMain>,
  ...functions: Function[]
) => (initialState: S) => Actor;
/**
 * Creates an autonomous behavior-mode actor.
 *
 * The worker eagerly initializes with `initialState` and runs a persistent loop
 * that receives messages via `post()` or `request()` and returns updated state.
 *
 * @template S The actor state type.
 * @template Q The request payload type for main-thread requests.
 * @template D The response data type for main-thread requests.
 * @template ToMain The type of one-way messages sent from worker to main.
 * @template FromMain The type of one-way messages sent from main to worker.
 * @param arg1 Either a config object or the behavior function.
 * @param rest Helper functions available inside the worker.
 */
export function actor<S = any, Q = any, D = any, ToMain = any, FromMain = any>(
  arg1: ActorConfig<Q, D, ToMain> | ActorCustomMessageHandlerConfig | ActorBehavior<S, Q, D, FromMain, ToMain>,
  ...rest: Function[]
): ((initialState: S) => Actor) | (<S2 = any, FromMain2 = any>(
  behavior: ActorBehavior<S2, Q, D, FromMain2, ToMain>,
  ...functions: Function[]
) => (initialState: S2) => Actor) {
  if (typeof arg1 === "function") {
    // actor(behavior, ...helpers) => (initialState) => Actor
    const behavior = arg1 as ActorBehavior<S, Q, D, FromMain, ToMain>;
    const functions = rest;
    return (initialState: S) => createActor(undefined, behavior, initialState, functions);
  }

  // actor(config) => (behavior, ...helpers) => (initialState) => Actor
  const config = arg1 as ActorConfig<Q, D, ToMain> | ActorCustomMessageHandlerConfig;
  return <S2 = any, FromMain2 = any>(
    behavior: ActorBehavior<S2, Q, D, FromMain2, ToMain>,
    ...functions: Function[]
  ): ((initialState: S2) => Actor) => (initialState: S2) => createActor(config, behavior, initialState, functions);
}

function createActor<S = any, Q = any, D = any, ToMain = any, FromMain = any>(
  config: ActorConfig<Q, D, ToMain> | ActorCustomMessageHandlerConfig | undefined,
  behavior: ActorBehavior<S, Q, D, FromMain, ToMain>,
  initialState: S,
  functions: Function[]
): Actor {
  const workerScript = buildWorkerScript({
    helpers: [ACTOR_CONCURRENCY_RUNTIME, ...(config?.helpers || [])],
    main: behavior as any,
    functions,
    runtime: buildActorWorkerRuntime(),
  });

  const blobUrl = acquireBlobUrl(workerScript);
  const actorWorkerId = 1;
  const actorTaskId = String(actorWorkerId);

  let worker: Worker | null = null;
  let running = false;
  const messageHandlers = new Set<(payload: ToMain) => void>();
  let nextRequestId = 1;
  const pendingRequests = new Map<string, PendingActorRequest<S>>();
  let shutdownPromise: Promise<void> | null = null;
  let finishShutdown: (() => void) | null = null;
  let shouldReleaseBlobUrl = false;
  let hasReleasedBlobUrl = false;

  worker = new Worker(blobUrl, { type: "module" });
  (worker as any).__id = actorWorkerId;
  running = true;

  let actorRef: Actor;

  const releaseWorkerScript = () => {
    if (!shouldReleaseBlobUrl || hasReleasedBlobUrl) {
      return;
    }

    hasReleasedBlobUrl = true;
    releaseBlobUrl(workerScript);
  };

  const rejectPendingRequests = (message = ACTOR_STOPPED_ERROR_MESSAGE) => {
    if (pendingRequests.size === 0) {
      return;
    }

    for (const { reject } of pendingRequests.values()) {
      reject(new Error(message));
    }

    pendingRequests.clear();
  };

  const postToWorker = (
    target: Worker,
    message: Omit<WorkerProtocolMessage, "workerId">
  ) => {
    target.postMessage({
      workerId: actorWorkerId,
      ...message,
    });
  };

  const shutdown = (releaseBlobUrlOnExit: boolean) => {
    shouldReleaseBlobUrl ||= releaseBlobUrlOnExit;

    if (shutdownPromise) {
      releaseWorkerScript();
      return shutdownPromise;
    }

    running = false;
    rejectPendingRequests();

    const activeWorker = worker;
    if (!activeWorker) {
      releaseWorkerScript();
      return Promise.resolve();
    }

    shutdownPromise = new Promise<void>((resolve) => {
      let settled = false;

      const finalizeShutdown = () => {
        if (settled) {
          return;
        }

        settled = true;
        finishShutdown = null;
        activeWorker.removeEventListener("message", handleMessage);
        activeWorker.terminate();
        if (worker === activeWorker) {
          worker = null;
        }
        releaseWorkerScript();
        resolve();
      };

      const timeoutId = setTimeout(finalizeShutdown, ACTOR_TERMINATION_TIMEOUT_MS);
      finishShutdown = () => {
        clearTimeout(timeoutId);
        finalizeShutdown();
      };

      try {
        postToWorker(activeWorker, {
          taskId: actorTaskId,
          type: "stop",
        });
      } catch {
        finishShutdown();
      }
    });

    return shutdownPromise;
  };

  const handleMessage = (event: MessageEvent<WorkerProtocolMessage>) => {
    const msg = event.data;
    const { type, payload, requestId } = msg;

    if (type === "response" && requestId && pendingRequests.has(requestId)) {
      const { resolve } = pendingRequests.get(requestId)!;
      pendingRequests.delete(requestId);
      resolve(payload);
    } else if (type === "error" && requestId && pendingRequests.has(requestId)) {
      const { reject } = pendingRequests.get(requestId)!;
      pendingRequests.delete(requestId);
      reject(new Error(msg.error ?? "Actor request failed"));
    } else if (type === "request") {
      handleRequest(msg, config, worker!);
    } else if (type === "notify") {
      handleWorkerMessage(msg, config, messageHandlers);
      pushGlobalInbox(actorRef, payload);
    } else if (type === "stopped") {
      running = false;
      rejectPendingRequests();
      finishShutdown?.();
    }
  };

  worker.addEventListener("message", handleMessage);

  postToWorker(worker, {
    taskId: actorTaskId,
    payload: initialState,
    type: "init",
  });

  const actor: Actor = {
    get running() {
      return running;
    },

    stop(_reason) {
      if (!running && !worker) return;
      void shutdown(false);
    },

    async finalize() {
      await shutdown(true);
    },
  };

  actorRef = actor;

  (actor as any)[$actorInternals] = {
    post(msg: FromMain) {
      if (!worker || !running) {
        console.warn("Actor is not running; message dropped");
        return;
      }
      postToWorker(worker, {
        taskId: actorTaskId,
        payload: msg,
        type: "notify",
      });
    },

    request(msg: FromMain): Promise<S> {
      if (!worker || !running) {
        return Promise.reject(new Error("Actor stopped"));
      }
      const id = String(nextRequestId++);
      return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        postToWorker(worker!, {
          taskId: actorTaskId,
          payload: msg,
          requestId: id,
          type: "request",
        });
      });
    },

    onMessage(handler: (payload: ToMain) => void): () => void {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
  };

  return actor;
}

const $actorInternals = Symbol("actorInternals");

interface GlobalInboxEntry {
  actor: Actor;
  payload: any;
}

let globalInboxQueue: GlobalInboxEntry[] = [];
let globalInboxResolvers: Array<(entry: GlobalInboxEntry) => void> = [];

function pushGlobalInbox(actor: Actor, payload: any) {
  const entry = { actor, payload };
  const resolver = globalInboxResolvers.shift();
  if (resolver) {
    resolver(entry);
  } else {
    globalInboxQueue.push(entry);
  }
}

interface InboxAPI {
  <ToMain>(actor: Actor, handler: (payload: ToMain) => void): () => void;
  (): Promise<GlobalInboxEntry>;
}

/**
 * Main-thread communication utility.
 *
 * Mirrors the worker-side `utils` structure:
 * - `main.outbox.send(actor, msg)` — fire-and-forget
 * - `main.outbox.request(actor, msg)` — send and await updated state
 * - `main.inbox.receive(actor, handler)` — subscribe to one actor's events
 * - `main.inbox.receive()` — global inbox; await next message from any actor
 */
export const main = {
  outbox: {
    /** Sends a one-way message to the actor. */
    send<FromMain>(actor: Actor, msg: FromMain): void {
      (actor as any)[$actorInternals].post(msg);
    },

    /** Sends a message and awaits the updated state. */
    request<FromMain, S>(actor: Actor, msg: FromMain): Promise<S> {
      return (actor as any)[$actorInternals].request(msg);
    },
  },

  inbox: {
    receive: ((actorOrHandler?: any, handler?: any): (() => void) | Promise<GlobalInboxEntry> => {
      if (actorOrHandler === undefined) {
        if (globalInboxQueue.length > 0) {
          return Promise.resolve(globalInboxQueue.shift()!);
        }
        return new Promise((resolve) => {
          globalInboxResolvers.push(resolve);
        });
      }
      return (actorOrHandler as any)[$actorInternals].onMessage(handler);
    }) as InboxAPI,
  },
};
