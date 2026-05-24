import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";
import {
  background,
  channel,
  ChannelClosedError,
  ContextCancelledError,
  otherwise,
  recv,
  select,
  send,
  withCancel,
  withDeadline,
  withTimeout,
  type Channel,
  type ReceiveResult,
} from "../utils";
import {
  createDefaultMessageHandler,
  type CoroutineMessage,
  type PendingTaskMap,
  type WorkerMessageHandler,
} from "../worker";
import { createTaskPool, type WorkerPoolConfig } from "../worker/pool";
import { buildWorkerScript } from "../worker/script";
import type { Actor, TaskPool } from "../worker/types";

/**
 * Concurrency utils injected into actor workers.
 *
 * Provides channel operations, context control, and select helpers
 * that mirror the main-thread API but run inside the worker scope.
 */
export type WorkerConcurrency = {
  channel: typeof channel;
  recv: typeof recv;
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
 * Bridge API exposed to actor workers for communicating with the main thread.
 *
 * @template Q The request payload type sent from the worker.
 * @template D The response data type returned to the worker.
 * @template FromMain The type of one-way messages sent from main to worker.
 * @template ToMain The type of one-way messages sent from worker to main.
 */
export type MainThreadBridge<Q = any, D = any, FromMain = any, ToMain = any> = {
  /** Sends a one-way message to the main thread. */
  send: (payload: ToMain) => void;
  /** Sends a request to the main thread and awaits a response. */
  request: (payload: Q) => Promise<D>;
  /** Receives a message from the main thread, or `undefined` if the inbox closes. */
  recv: (signal?: AbortSignal) => Promise<FromMain | undefined>;
  /** Receives a full result from the main thread inbox. */
  receive: (signal?: AbortSignal) => Promise<ReceiveResult<FromMain>>;
  /** The worker's inbox channel for messages from the main thread. */
  inbox: Channel<FromMain>;
};

/**
 * Utility functions available only to actor worker tasks.
 */
export type WorkerUtils<Q = any, D = any, FromMain = any, ToMain = any> = {
  concurrency: WorkerConcurrency;
  main: MainThreadBridge<Q, D, FromMain, ToMain>;
};

/**
 * Worker task signature for actor workers.
 */
export type ActorTask<T = any, R = any, Q = any, D = any, FromMain = any, ToMain = any> =
  | ((data: T) => Promise<R> | R)
  | ((data: T, utils: WorkerUtils<Q, D, FromMain, ToMain>) => Promise<R> | R);

/**
 * Request handler used by `utils.main.request()`.
 *
 * Keep this function small, or delegate to a `coroutine(...)` instance via
 * `request: dataWorker.processTask` when data resolution itself is expensive.
 */
export type ActorRequestHandler<Q = any, D = any> = (
  request: Q,
  message: CoroutineMessage
) => Promise<D> | D;

/**
 * Configuration for actor workers.
 *
 * `request` resolves `utils.main.request(payload)` calls initiated from inside
 * the worker. `onMessage` receives one-way `utils.main.send(payload)` traffic.
 */
export type ActorConfig<Q = any, D = any, ToMain = any> = WorkerPoolConfig & {
  request?: ActorRequestHandler<Q, D>;
  onMessage?: (payload: ToMain, message: CoroutineMessage) => void | Promise<void>;
  customMessageHandler?: WorkerMessageHandler;
};

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
    receive: receiveValue,
    async recv(signal) {
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

const __streamixSelect = async (cases, ctx = __streamixBackground()) => {
  if (ctx.signal.aborted) throw __streamixCreateAbortError(ctx.signal);

  const defaultIndex = cases.findIndex((item) => item.op === "default");

  for (let index = 0; index < cases.length; index++) {
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

      for (let index = 0; index < cases.length; index++) {
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
  recv: __streamixRecv,
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

/**
 * Actor workers use a richer message contract than plain coroutines.
 * `taskId` identifies the outer task while `requestId` identifies nested
 * `utils.main.request()` round-trips initiated from inside the worker. Failed
 * request replies reuse `"error"` and are distinguished by `requestId`.
 */
const buildActorWorkerRuntime = (): string =>
  [
    "const __pendingWorkerRequests = new Map();",
    "const __taskMailboxes = new Map();",
    "let __activeTaskId = null;",
    "let __requestCounter = 0;",
    "",
    "const __postToMain = (message) => {",
    "  postMessage(message);",
    "};",
    "",
    "const __createRequestId = (taskId) => {",
    "  __requestCounter += 1;",
    "  return taskId + ':request:' + __requestCounter;",
    "};",
    "",
    "const __requestMain = (workerId, taskId, payload) => {",
    "  return new Promise((resolve, reject) => {",
    "    const requestId = __createRequestId(taskId);",
    "    __pendingWorkerRequests.set(requestId, { resolve, reject });",
    "    __postToMain({ workerId, taskId, requestId, type: 'request', payload });",
    "  });",
    "};",
    "",
    "const __getTaskMailbox = (taskId) => {",
    "  if (!__taskMailboxes.has(taskId)) {",
    "    __taskMailboxes.set(taskId, __streamixConcurrency.channel());",
    "  }",
    "  return __taskMailboxes.get(taskId);",
    "};",
    "",
    "const __closeTaskMailbox = (taskId) => {",
    "  const mailbox = __taskMailboxes.get(taskId);",
    "  if (mailbox) {",
    "    mailbox.close();",
    "    __taskMailboxes.delete(taskId);",
    "  }",
    "  if (__activeTaskId === taskId) {",
    "    __activeTaskId = null;",
    "  }",
    "};",
    "",
    "const __createMainBridge = (workerId, taskId) => {",
    "  const inbox = __getTaskMailbox(taskId);",
    "  return {",
    "    send: (messagePayload) => __postToMain({ workerId, taskId, payload: messagePayload, type: 'worker-message' }),",
    "    request: (requestPayload) => __requestMain(workerId, taskId, requestPayload),",
    "    recv: (signal) => inbox.recv(signal),",
    "    receive: (signal) => inbox.receive(signal),",
    "    inbox,",
    "  };",
    "};",
    "",
    "const __createWorkerUtils = (workerId, taskId) => {",
    "  const main = __createMainBridge(workerId, taskId);",
    "  return {",
    "    main,",
    "    concurrency: __streamixConcurrency,",
    "  };",
    "};",
    "",
    "onmessage = async (event) => {",
    "  const { workerId, taskId, payload, type, requestId, error } = event.data;",
    "",
    "  if (type === 'main-message') {",
    "    const targetTaskId = taskId || __activeTaskId;",
    "    if (!targetTaskId) {",
    "      console.warn('Actor worker received main message without active task', event.data);",
    "      return;",
    "    }",
    "",
    "    const mailbox = __getTaskMailbox(targetTaskId);",
    "    mailbox.send(payload).catch((error) => {",
    "      console.warn('Actor worker failed to enqueue main-thread message', error);",
    "    });",
    "    return;",
    "  }",
    "",
    "  if (type === 'data' || (type === 'error' && !!requestId)) {",
    "    if (!requestId) {",
    "      console.warn('Actor worker received request response without requestId', event.data);",
    "      return;",
    "    }",
    "",
    "    const pendingRequest = __pendingWorkerRequests.get(requestId);",
    "    if (pendingRequest) {",
    "      __pendingWorkerRequests.delete(requestId);",
    "      if (type === 'data') {",
    "        pendingRequest.resolve(payload);",
    "      } else {",
    "        pendingRequest.reject(new Error(error || payload?.error || payload?.message || 'Actor request failed'));",
    "      }",
    "    }",
    "    return;",
    "  }",
    "",
    "  if (type !== 'task') {",
    "    return;",
    "  }",
    "",
    "  try {",
    "    __activeTaskId = taskId;",
    "    const result = await __mainTask(payload, __createWorkerUtils(workerId, taskId));",
    "    __postToMain({ workerId, taskId, payload: result, type: 'response' });",
    "  } catch (error) {",
    "    const message = error instanceof Error ? error.message : String(error);",
    "    __postToMain({ workerId, taskId, error: message, type: 'error' });",
    "  } finally {",
    "    __closeTaskMailbox(taskId);",
    "  }",
    "};",
  ].join("\n");

function createActorMessageHandler<Q, D, ToMain>(
  config?: ActorConfig<Q, D, ToMain>
) {
  return (worker: Worker, pendingTasks: PendingTaskMap) => {
    if (config?.customMessageHandler) {
      return (event: MessageEvent<CoroutineMessage>) =>
        config.customMessageHandler!(event, worker, pendingTasks);
    }

    return createDefaultMessageHandler(worker, pendingTasks, {
      onRequest: async (message) => {
        const { workerId, taskId, requestId, payload } = message;

        if (!requestId) {
          worker.postMessage({
            workerId,
            taskId,
            type: "error",
            error: "Actor request is missing requestId",
          });
          return;
        }

        if (!config?.request) {
          worker.postMessage({
            workerId,
            taskId,
            requestId,
            type: "error",
            error: "No actor request handler configured",
          });
          return;
        }

        try {
          const result = await config.request(payload as Q, message);
          worker.postMessage({
            workerId,
            taskId,
            requestId,
            type: "data",
            payload: result,
          });
        } catch (error) {
          worker.postMessage({
            workerId,
            taskId,
            requestId,
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      onWorkerMessage: async (message) => {
        if (config?.onMessage) {
          await config.onMessage(message.payload as ToMain, message);
        }
      }
    });
  };
}

/**
 * Creates a configured actor worker factory with message/request hooks.
 */
export function actor<Q = any, D = any, ToMain = any, FromMain = any>(
  config: ActorConfig<Q, D, ToMain>
): <T, R>(main: ActorTask<T, R, Q, D, FromMain, ToMain>, ...functions: Function[]) => Actor<T, R, FromMain, ToMain> & WorkerPool<T, R>;
/**
 * Creates an actor worker directly from a task function and optional helpers.
 */
export function actor<T, R>(main: ActorTask<T, R>, ...functions: Function[]): Actor<T, R> & WorkerPool<T, R>;
/**
 * Creates an actor worker coroutine.
 *
 * When called with a configuration object, returns a factory function that accepts
 * the actor task and optional helpers. When called with a task function directly,
 * creates the actor coroutine immediately using default configuration.
 *
 * @template T The type of input data.
 * @template R The type of output data.
 * @template Q The request payload type for main-thread requests.
 * @template D The response data type for main-thread requests.
 * @template ToMain The type of one-way messages sent from worker to main.
 * @template FromMain The type of one-way messages sent from main to worker.
 * @param arg1 Either an `ActorConfig` or the main `ActorTask`.
 * @param rest Optional helper functions available inside the worker.
 * @returns An `Actor` instance or a factory that produces one.
 */
export function actor<T, R, Q = any, D = any, ToMain = any, FromMain = any>(
  arg1: ActorConfig<Q, D, ToMain> | ActorTask<T, R, Q, D, FromMain, ToMain>,
  ...rest: Function[]
): (Actor<T, R, FromMain, ToMain> & WorkerPool<T, R>) | ((main: ActorTask<T, R, Q, D, FromMain, ToMain>, ...functions: Function[]) => Actor<T, R, FromMain, ToMain> & WorkerPool<T, R>) {
  const implementActor = (
    config: ActorConfig<Q, D, ToMain> | undefined,
    main: ActorTask<T, R, Q, D, FromMain, ToMain>,
    functions: Function[]
  ): Actor<T, R, FromMain, ToMain> & WorkerPool<T, R> => {
    const messageHandlers = new Set<(payload: ToMain) => void>();

    // Seed any static handler provided in config into the set
    if (config?.onMessage) {
      const staticHandler = config.onMessage;
      messageHandlers.add((payload) => staticHandler(payload, {} as CoroutineMessage));
    }

    // Merged config routes all worker-message traffic through the handler set
    const mergedConfig: ActorConfig<Q, D, ToMain> = {
      ...config,
      onMessage: (payload, _message) => {
        messageHandlers.forEach((h) => h(payload));
      },
    };

    const pool = createTaskPool<T, R>({
      name: "actor",
      config: mergedConfig,
      main,
      functions,
      generateWorkerScript: (task, dependencies, workerConfig) =>
        buildWorkerScript({
          helpers: [ACTOR_CONCURRENCY_RUNTIME, ...(workerConfig?.helpers || [])],
          main: task,
          functions: dependencies,
          runtime: buildActorWorkerRuntime(),
        }),
      createMessageHandler: createActorMessageHandler(mergedConfig),
    });

    const operator = createOperator<T, R>("actor", function (this: Operator, source) {
      let completed = false;

      return {
        next: async () => {
          while (true) {
            if (completed) return DONE;

            const result = await source.next();
            if (result.done) {
              completed = true;
              await pool.finalize();
              return DONE;
            }

            const taskResult = await pool.processTask(result.value as T);
            return NEXT(taskResult);
          }
        },
        async return() {
          completed = true;
          await pool.finalize();
          return DONE;
        },
        async throw(err) {
          completed = true;
          await pool.finalize();
          throw err;
        }
      };
    });

    return Object.assign({ ...operator,
      pool,
      async processTask(data: T) {
        return pool.processTask(data);
      },
      async finalize() {
        return pool.finalize();
      },
    }, {
      sendToWorker(worker: Worker, payload: FromMain) {
        pool.postMessageToWorker(worker, {
          taskId: "",
          type: "main-message",
          payload,
        });
      },
      onMessage(handler: (payload: ToMain) => void): () => void {
        messageHandlers.add(handler);
        return () => messageHandlers.delete(handler);
      },
    }) as Actor<T, R, FromMain, ToMain>;
  };

  if (typeof arg1 === "function") {
    return implementActor(undefined, arg1 as ActorTask<T, R, Q, D, FromMain, ToMain>, rest);
  }

  return (main: ActorTask<T, R, Q, D, FromMain, ToMain>, ...functions: Function[]) =>
    implementActor(arg1, main, functions);
}

export type { CoroutineMessage } from "../worker/messages";

