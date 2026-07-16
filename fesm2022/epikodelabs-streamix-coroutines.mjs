import { isPromiseLike } from '@epikodelabs/streamix';

/**
 * Thrown when a context is cancelled or times out.
 */
class ContextCancelledError extends Error {
    constructor(message = "context cancelled") {
        super(message);
        this.name = "ContextCancelledError";
    }
}
/**
 * Creates an abort error from an `AbortSignal`'s reason.
 *
 * @param signal The abort signal to extract the reason from.
 * @returns An `Error` instance representing the abort reason.
 */
const createAbortError = (signal) => {
    const reason = signal?.reason;
    if (reason instanceof Error)
        return reason;
    return new ContextCancelledError(reason ? String(reason) : undefined);
};
const createContextFromState = (state) => {
    const done = new Promise((resolve) => {
        if (state.controller.signal.aborted) {
            resolve();
        }
        else {
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
            if (state.values.has(key))
                return state.values.get(key);
            return state.parent?.value(key);
        },
        withValue(key, value) {
            const values = new Map();
            values.set(key, value);
            return createContextFromState({
                controller: state.controller,
                values,
                parent: this,
            });
        },
    };
};
/**
 * Creates a root context that is not derived from any parent.
 *
 * @returns A new background `Context`.
 */
const background = () => createContextFromState({ controller: new AbortController(), values: new Map() });
/**
 * Derives a cancellable child context from a parent.
 *
 * The child is automatically cancelled when the parent is cancelled.
 *
 * @param parent The parent context. Defaults to `background()`.
 * @returns A tuple of `[childContext, cancel]`.
 */
function withCancel(parent = background()) {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort(parent.reason ?? new ContextCancelledError());
    if (parent.signal.aborted) {
        onParentAbort();
    }
    else {
        parent.signal.addEventListener("abort", onParentAbort, { once: true });
    }
    const ctx = createContextFromState({ controller, values: new Map(), parent });
    const cancel = (reason = new ContextCancelledError()) => {
        parent.signal.removeEventListener("abort", onParentAbort);
        if (!controller.signal.aborted)
            controller.abort(reason);
    };
    return [ctx, cancel];
}
/**
 * Derives a child context that automatically cancels after a timeout.
 *
 * @param parent The parent context.
 * @param ms Timeout in milliseconds.
 * @returns A tuple of `[childContext, cancel]`.
 */
function withTimeout(parent, ms) {
    const [ctx, cancel] = withCancel(parent);
    const timer = setTimeout(() => cancel(new ContextCancelledError(`context timeout after ${ms}ms`)), ms);
    ctx.done.finally(() => clearTimeout(timer));
    return [ctx, cancel];
}
/**
 * Derives a child context that automatically cancels at a specific deadline.
 *
 * @param parent The parent context.
 * @param deadline A `Date` or timestamp (in milliseconds) when the context should cancel.
 * @returns A tuple of `[childContext, cancel]`.
 */
function withDeadline(parent, deadline) {
    const time = typeof deadline === "number" ? deadline : deadline.getTime();
    return withTimeout(parent, Math.max(0, time - Date.now()));
}

/**
 * Thrown when sending to or receiving from a closed channel.
 */
class ChannelClosedError extends Error {
    constructor(message = "channel is closed") {
        super(message);
        this.name = "ChannelClosedError";
    }
}
/**
 * Internal symbol used by `select(...)` to access atomic wait-list hooks on a channel.
 *
 * This is exported so `select.ts` can coordinate with the channel implementation,
 * but it is not part of the normal end-user API surface.
 *
 * @internal
 */
const CHANNEL_INTERNALS = Symbol("streamix.channelInternals");
/**
 * Creates a new async channel with the given buffer capacity.
 *
 * @param capacity - Buffer size. `0` means unbuffered (hand-off semantics). Must be a non-negative integer.
 * @returns A new channel.
 */
function channel(capacity = 0) {
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
        if (index >= 0)
            receivers.splice(index, 1);
        cleanupReceiver(receiver);
    };
    const removeSender = (sender) => {
        const index = senders.indexOf(sender);
        if (index >= 0)
            senders.splice(index, 1);
        cleanupSender(sender);
    };
    /**
     * Settles a waiting receive-side select case with the value it won.
     */
    const settleSelectedReceive = (receiver, result) => {
        const outcome = {
            index: receiver.select.meta.index,
            caseRef: receiver.select.meta.caseRef,
            op: "receive",
            name: receiver.select.meta.name,
            ok: result.ok,
        };
        if (result.ok) {
            outcome.value = result.value;
        }
        return receiver.select.registration.settle(outcome);
    };
    /**
     * Settles a waiting send-side select case after its value has been accepted.
     */
    const settleSelectedSend = (sender) => sender.select.registration.settle({
        index: sender.select.meta.index,
        caseRef: sender.select.meta.caseRef,
        op: "send",
        name: sender.select.meta.name,
        ok: true,
    });
    /**
     * Rejects a select waiter when the channel is closed.
     */
    const rejectSelectedWaiter = (waiter, error) => waiter.select.registration.reject(error);
    /**
     * Tries to hand a value directly to the first compatible waiting receiver.
     *
     * When called from a select-managed sender we must avoid matching the sender
     * with a receiver owned by the same outer select registration.
     */
    const tryDispatchToWaitingReceiver = (value, senderSelectId) => {
        for (let index = 0; index < receivers.length; index++) {
            const receiver = receivers[index];
            const receiverSelectId = receiver.select?.registration.id;
            if (receiver.select?.registration.isSettled()) {
                receivers.splice(index, 1);
                cleanupReceiver(receiver);
                index--;
                continue;
            }
            if (senderSelectId && receiverSelectId === senderSelectId) {
                continue;
            }
            receivers.splice(index, 1);
            cleanupReceiver(receiver);
            if (receiver.select) {
                if (!settleSelectedReceive(receiver, { ok: true, value })) {
                    index--;
                    continue;
                }
            }
            else {
                receiver.resolve({ ok: true, value });
            }
            return true;
        }
        return false;
    };
    /**
     * Tries to pull one waiting sender out of the queue and complete it.
     *
     * When called from a select-managed receiver we must avoid matching the
     * receiver with a sender owned by the same outer select registration.
     */
    const tryAcquireFromWaitingSender = (receiverSelectId) => {
        for (let index = 0; index < senders.length; index++) {
            const sender = senders[index];
            const senderSelectId = sender.select?.registration.id;
            if (sender.select?.registration.isSettled()) {
                senders.splice(index, 1);
                cleanupSender(sender);
                index--;
                continue;
            }
            if (receiverSelectId && senderSelectId === receiverSelectId) {
                continue;
            }
            senders.splice(index, 1);
            cleanupSender(sender);
            if (sender.select) {
                if (!settleSelectedSend(sender)) {
                    index--;
                    continue;
                }
            }
            else {
                sender.resolve();
            }
            return { ok: true, value: sender.value };
        }
        if (isClosed) {
            return { ok: false, value: undefined };
        }
        return undefined;
    };
    /**
     * Moves the next waiting sender into the channel buffer when space is available.
     */
    const tryBufferWaitingSender = () => {
        for (let index = 0; index < senders.length; index++) {
            const sender = senders[index];
            if (sender.select?.registration.isSettled()) {
                senders.splice(index, 1);
                cleanupSender(sender);
                index--;
                continue;
            }
            senders.splice(index, 1);
            cleanupSender(sender);
            if (sender.select) {
                if (!settleSelectedSend(sender)) {
                    index--;
                    continue;
                }
            }
            else {
                sender.resolve();
            }
            buffer.push(sender.value);
            return true;
        }
        return false;
    };
    /**
     * Pairs queued senders with queued receivers while preserving select atomicity.
     */
    const tryPairWaitingSenderToReceiver = () => {
        for (let index = 0; index < senders.length; index++) {
            const sender = senders[index];
            const senderSelectId = sender.select?.registration.id;
            if (sender.select?.registration.isSettled()) {
                senders.splice(index, 1);
                cleanupSender(sender);
                index--;
                continue;
            }
            if (!tryDispatchToWaitingReceiver(sender.value, senderSelectId)) {
                continue;
            }
            senders.splice(index, 1);
            cleanupSender(sender);
            if (sender.select) {
                if (!settleSelectedSend(sender)) {
                    index--;
                    continue;
                }
            }
            else {
                sender.resolve();
            }
            return true;
        }
        return false;
    };
    /**
     * Advances queued senders after a receive frees space or a receiver becomes available.
     */
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
    const send = (value, signal) => {
        if (isClosed)
            return Promise.reject(new ChannelClosedError());
        if (signal?.aborted)
            return Promise.reject(createAbortError(signal));
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
                    reject(createAbortError(signal));
                };
                signal.addEventListener("abort", sender.abort, { once: true });
            }
            senders.push(sender);
        });
    };
    const instance = {
        get capacity() {
            return capacity;
        },
        get size() {
            return buffer.length;
        },
        get closed() {
            return isClosed;
        },
        send,
        async receive(signal) {
            if (buffer.length > 0) {
                const value = buffer.shift();
                flushSenders();
                return value;
            }
            const matchedSender = tryAcquireFromWaitingSender();
            if (matchedSender) {
                return matchedSender.ok ? matchedSender.value : undefined;
            }
            if (isClosed) {
                return undefined;
            }
            if (signal?.aborted)
                return Promise.reject(createAbortError(signal));
            const result = await new Promise((resolve, reject) => {
                const receiver = { resolve, reject, signal };
                if (signal) {
                    receiver.abort = () => {
                        removeReceiver(receiver);
                        reject(createAbortError(signal));
                    };
                    signal.addEventListener("abort", receiver.abort, { once: true });
                }
                receivers.push(receiver);
            });
            return result.ok ? result.value : undefined;
        },
        trySend(value) {
            if (isClosed)
                return false;
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
            if (isClosed)
                return { ok: false, value: undefined };
            return undefined;
        },
        close() {
            if (isClosed)
                return;
            isClosed = true;
            while (receivers.length > 0) {
                const receiver = receivers.shift();
                cleanupReceiver(receiver);
                if (receiver.select) {
                    settleSelectedReceive(receiver, { ok: false, value: undefined });
                }
                else {
                    receiver.resolve({ ok: false, value: undefined });
                }
            }
            while (senders.length > 0) {
                const sender = senders.shift();
                cleanupSender(sender);
                const error = new ChannelClosedError();
                if (sender.select) {
                    rejectSelectedWaiter(sender, error);
                }
                else {
                    sender.reject(error);
                }
            }
        },
        [CHANNEL_INTERNALS]: {
            registerSelectReceive(registration, meta) {
                const receiver = {
                    resolve: () => { },
                    reject: () => { },
                    select: { registration, meta },
                };
                receivers.push(receiver);
                return () => removeReceiver(receiver);
            },
            registerSelectSend(value, registration, meta) {
                if (isClosed) {
                    registration.reject(new ChannelClosedError());
                    return () => { };
                }
                const sender = {
                    value,
                    resolve: () => { },
                    reject: () => { },
                    select: { registration, meta },
                };
                senders.push(sender);
                return () => removeSender(sender);
            },
        },
        async *[Symbol.asyncIterator]() {
            while (true) {
                const item = await this.receive();
                if (item === undefined)
                    return;
                yield item;
            }
        },
    };
    return instance;
}

/**
 * Creates the default main-thread worker message handler.
 */
function createDefaultMessageHandler(_worker, pendingTasks, options) {
    return (event) => {
        const msg = event.data;
        const { taskId, payload, error, type } = msg;
        const pending = pendingTasks.get(taskId);
        switch (type) {
            case "response":
                if (pending) {
                    pendingTasks.delete(taskId);
                    pending.resolve(payload);
                }
                break;
            case "error": {
                const errorMessage = error?.trim?.() ? error : "Unknown worker error";
                if (pending) {
                    pendingTasks.delete(taskId);
                    pending.reject(new Error(errorMessage));
                }
                break;
            }
            case "request":
                if (options?.onRequest) {
                    Promise.resolve(options.onRequest(msg)).catch((hookError) => {
                        console.warn("Worker request hook failed:", hookError);
                    });
                }
                else {
                    console.warn("Unhandled worker request:", msg);
                }
                break;
            case "notify":
                if (options?.onWorkerMessage) {
                    Promise.resolve(options.onWorkerMessage(msg)).catch((hookError) => {
                        console.warn("Worker message hook failed:", hookError);
                    });
                }
                else {
                    console.warn("Unhandled worker message:", msg);
                }
                break;
            default:
                console.warn("Unknown message type from worker:", msg);
                break;
        }
    };
}

/**
 * Internal bootstrap required by transpiled async/generator code inside worker
 * tasks and injected helper functions.
 */
const ASYNC_WORKER_BOOTSTRAP = `var __defProp=Object.defineProperty,__defProps=Object.defineProperties,__getOwnPropDescs=Object.getOwnPropertyDescriptors,__getOwnPropSymbols=Object.getOwnPropertySymbols,__hasOwnProp=Object.prototype.hasOwnProperty,__propIsEnum=Object.prototype.propertyIsEnumerable,__knownSymbol=(r,e)=>(e=Symbol[r])?e:Symbol.for("Symbol."+r),__defNormalProp=(r,e,o)=>e in r?__defProp(r,e,{enumerable:!0,configurable:!0,writable:!0,value:o}):r[e]=o,__spreadValues=(r,e)=>{for(var o in e||={})__hasOwnProp.call(e,o)&&__defNormalProp(r,o,e[o]);if(__getOwnPropSymbols)for(var o of __getOwnPropSymbols(e))__propIsEnum.call(e,o)&&__defNormalProp(r,o,e[o]);return r},__spreadProps=(r,e)=>__defProps(r,__getOwnPropDescs(e)),__async=(r,e,o)=>new Promise((t,n)=>{var a=r=>{try{s(o.next(r))}catch(e){n(e)}},p=r=>{try{s(o.throw(r))}catch(e){n(e)}},s=r=>r.done?t(r.value):Promise.resolve(r.value).then(a,p);s((o=o.apply(r,e)).next())}),__await=function(r,e){this[0]=r,this[1]=e},__asyncGenerator=(r,e,o)=>{var t=(r,e,n,a)=>{try{var p=o[r](e),s=(e=p.value)instanceof __await,l=p.done;Promise.resolve(s?e[0]:e).then(o=>s?t("return"===r?r:"next",e[1]?{done:o.done,value:o.value}:o,n,a):n({value:o,done:l})).catch(r=>t("throw",r,n,a))}catch(y){a(y)}},n=r=>a[r]=e=>new Promise((o,n)=>t(r,e,o,n)),a={};return o=o.apply(r,e),a[__knownSymbol("asyncIterator")] =()=>a,n("next"),n("throw"),n("return"),a};`;
/**
 * Serializes helper and task functions for worker-script injection.
 */
function serializeFunction(fn) {
    return fn.toString().replace(/function[\s]*\(/, `function ${fn.name || ""}(`);
}
/**
 * Derives the string representation of a `CoroutineScript` from its
 * function source(s).  This is the single source-of-truth for how
 * `main` and `functions` are turned into worker-transmittable code.
 */
function serializeScript(script) {
    return {
        code: script.main.toString(),
        deps: (script.functions || []).map((f) => f.toString()),
    };
}
const joinScriptSections = (sections) => sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join("\n\n");
/**
 * Builds a worker script from:
 * - internal async bootstrap
 * - user-supplied helper snippets
 * - serialized helper functions
 * - the main task function
 * - the runtime wrapper
 */
function buildWorkerScript({ helpers, main, functions, runtime, }) {
    const helperSections = [ASYNC_WORKER_BOOTSTRAP, ...(helpers || [])];
    const dependencySection = functions.map(serializeFunction).join(";\n");
    const mainSection = `const __mainTask = ${serializeFunction(main)};`;
    return joinScriptSections([
        ...helperSections,
        dependencySection,
        mainSection,
        runtime,
    ]);
}

/**
 * Standard coroutine worker runtime.
 *
 * Used by `coroutine()`, `compute()`, and `compose()`.
 */
const buildCoroutineWorkerRuntime = () => `
const __serializeWorkerError = (error) => {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (error === undefined) return "Worker task threw undefined";
  if (error === null) return "Worker task threw null";
  return String(error);
};

onmessage = async (event) => {
  const { workerId, taskId, payload, type } = event.data;

  if (type !== 'task') {
    return;
  }

  try {
    const result = await __mainTask(payload);
    postMessage({ workerId, taskId, payload: result, type: 'response' });
  } catch (error) {
    const message = __serializeWorkerError(error);
    postMessage({ workerId, taskId, error: message, type: 'error' });
  }
};`;
/**
 * Actor worker runtime.
 *
 * Supports persistent behavior loop via `init`, `notify`, `request`,
 * and `stop` messages. Uses `__streamixConcurrency` helpers injected
 * by the build script.
 */
const buildActorWorkerRuntime = () => `
const __serializeWorkerError = (error) => {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (error === undefined) return "Worker task threw undefined";
  if (error === null) return "Worker task threw null";
  return String(error);
};

const __pendingWorkerRequests = new Map();
let __requestCounter = 0;

const __postToMain = (message) => {
  postMessage(message);
};

const __createRequestId = (taskId) => {
  __requestCounter += 1;
  return taskId + ':request:' + __requestCounter;
};

const __requestMain = (workerId, taskId, to, topic, payload) => {
  return new Promise((resolve, reject) => {
    const requestId = __createRequestId(taskId);
    __pendingWorkerRequests.set(requestId, { resolve, reject });
    __postToMain({ workerId, taskId, requestId, to, topic, type: 'request', payload });
  });
};

const __workerInbox = __streamixConcurrency.channel();

const __enqueueActorInbox = (payload, scope) => {
  __workerInbox.send(payload).catch((error) => {
    console.warn(scope, error);
  });
};

const __createWorkerUtils = (workerId, taskId) => {
  const outbox = {
    request: (to, topic, requestPayload) => __requestMain(workerId, taskId, to, topic, requestPayload),
    send: (to, topic, messagePayload) => {
      __postToMain({
        workerId,
        taskId,
        payload: { kind: 'actor-bus', to, topic, payload: messagePayload },
        type: 'notify',
      });
    },
  };
  return {
    outbox,
    inbox: {
      listen: (signal) => __workerInbox.receive(signal),
    },
    concurrency: __streamixConcurrency,
  };
};

const __actorMailbox = __streamixConcurrency.channel();
let __actorState = undefined;
let __actorRunning = false;
let __actorId = null;
let __workerId = null;

const __runBehaviorLoop = async (workerId, taskId) => {
  const utils = __createWorkerUtils(workerId, taskId);

  while (__actorRunning) {
    const envelope = await __actorMailbox.receive();
    if (!envelope) break;

    let msg = envelope;
    let replyId = null;

    if (envelope && typeof envelope === "object" && "requestId" in envelope) {
      replyId = envelope.requestId;
      msg = envelope.msg;
    }

    try {
      const result = await __mainTask(msg, __actorState, utils);
      __actorState = result;

      if (replyId) {
        __postToMain({ workerId, taskId, type: "response", requestId: replyId, payload: result });
      }
    } catch (error) {
      const message = __serializeWorkerError(error);
      if (replyId) {
        __postToMain({ workerId, taskId, type: "error", requestId: replyId, error: message });
      } else {
        __postToMain({ workerId, taskId, type: "notify", payload: { type: "error", error: message } });
      }
    }
  }

  __actorMailbox.close();
  __workerInbox.close();
  __postToMain({ workerId, taskId, type: "stopped" });
};

onmessage = async (event) => {
  const { workerId, taskId, payload, type, requestId, error, topic } = event.data;

  if (type === "notify") {
    if (__actorRunning) {
      __actorMailbox.send(payload).catch((error) => {
        console.warn("Actor worker failed to enqueue message", error);
      });
      if (payload && typeof payload === "object" && payload.kind === "actor-bus") {
        __enqueueActorInbox(payload, "Actor worker failed to mirror bus message to inbox");
      }
    } else {
      console.warn("Actor worker received main message before init", event.data);
    }
    return;
  }

  if (type === "response" || (type === "error" && !!requestId)) {
    if (!requestId) {
      console.warn("Actor worker received request response without requestId", event.data);
      return;
    }

    const pendingRequest = __pendingWorkerRequests.get(requestId);
    if (pendingRequest) {
      __pendingWorkerRequests.delete(requestId);
      if (type === "response") {
        pendingRequest.resolve(payload);
      } else {
        pendingRequest.reject(new Error(error || payload?.error || payload?.message || "Actor request failed"));
      }
    }
    return;
  }

  if (type === "init") {
    __workerId = workerId;
    __actorId = taskId;
    __actorState = payload;
    __actorRunning = true;
    __runBehaviorLoop(workerId, taskId);
    return;
  }

  if (type === "stop") {
    __actorRunning = false;
    __actorMailbox.close();
    __workerInbox.close();
    return;
  }

  if (type === "request" && !!requestId) {
    __actorMailbox.send({ msg: payload, requestId, topic }).catch((error) => {
      console.warn("Actor worker failed to enqueue request", error);
    });
    return;
  }
};`;

/**
 * Shared blob-URL cache keyed by the generated worker script body.
 *
 * Multiple abstractions can reuse the same worker blob URL when their
 * generated source is identical.
 */
const blobCache = new Map();
/**
 * Returns a reusable blob URL for a worker script and increments its refcount.
 */
function acquireBlobUrl(workerScript) {
    const cached = blobCache.get(workerScript);
    if (cached) {
        cached.refCount++;
        return cached.blobUrl;
    }
    const blob = new Blob([workerScript], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    blobCache.set(workerScript, { blobUrl, refCount: 1 });
    return blobUrl;
}
/**
 * Decrements the blob URL refcount and revokes it once unused.
 */
function releaseBlobUrl(workerScript) {
    const cached = blobCache.get(workerScript);
    if (!cached) {
        return;
    }
    cached.refCount--;
    if (cached.refCount <= 0) {
        URL.revokeObjectURL(cached.blobUrl);
        blobCache.delete(workerScript);
    }
}

/**
 * Generates a unique task identifier.
 */
function generateTaskId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

let workerIdentifierCounter = 0;
const toError = (error) => error instanceof Error ? error : new Error(String(error));
/**
 * Internal dedicated-worker task executor used by `coroutine()` and `compose()`.
 *
 * A runner owns one reusable worker instance, queues calls to `processTask()`,
 * and exposes only the high-level `TaskRunner` contract.
 */
function createTaskRunner({ name, config, main, functions, generateWorkerScript, createMessageHandler, }) {
    const queuedTasks = [];
    const pendingMessages = new Map();
    const runnerWorkerId = ++workerIdentifierCounter;
    const runnerTaskId = String(runnerWorkerId);
    const workerScript = generateWorkerScript(main, functions, config);
    const blobUrl = acquireBlobUrl(workerScript);
    let worker = null;
    let workerMessageHandler = null;
    let isProcessing = false;
    let isFinalizing = false;
    let hasReleasedBlobUrl = false;
    const releaseWorkerScript = () => {
        if (hasReleasedBlobUrl) {
            return;
        }
        hasReleasedBlobUrl = true;
        releaseBlobUrl(workerScript);
    };
    const getWorker = () => {
        if (worker) {
            return worker;
        }
        const nextWorker = new Worker(blobUrl, { type: "module" });
        workerMessageHandler = createMessageHandler
            ? createMessageHandler(nextWorker, pendingMessages)
            : createDefaultMessageHandler(nextWorker, pendingMessages);
        nextWorker.addEventListener("message", workerMessageHandler);
        nextWorker.__id = runnerWorkerId;
        worker = nextWorker;
        return nextWorker;
    };
    const submitTask = (worker, data) => {
        const taskId = generateTaskId() || runnerTaskId;
        return new Promise((resolve, reject) => {
            pendingMessages.set(taskId, { workerId: runnerWorkerId, resolve, reject });
            try {
                worker.postMessage({ workerId: runnerWorkerId, taskId, payload: data, type: "task" });
            }
            catch (error) {
                pendingMessages.delete(taskId);
                reject(toError(error));
            }
        });
    };
    const drainQueue = async () => {
        if (isProcessing || isFinalizing) {
            return;
        }
        const nextTask = queuedTasks.shift();
        if (!nextTask) {
            return;
        }
        isProcessing = true;
        try {
            const activeWorker = getWorker();
            const result = await submitTask(activeWorker, nextTask.value);
            nextTask.resolve(result);
        }
        catch (error) {
            nextTask.reject(toError(error));
        }
        finally {
            isProcessing = false;
            if (!isFinalizing) {
                void drainQueue();
            }
        }
    };
    const processTask = (value) => {
        if (isFinalizing) {
            return Promise.reject(new Error(`${name} finalized before a worker became available`));
        }
        return new Promise((resolve, reject) => {
            queuedTasks.push({ value, resolve, reject });
            void drainQueue();
        });
    };
    const finalize = async () => {
        if (isFinalizing) {
            return;
        }
        isFinalizing = true;
        while (queuedTasks.length > 0) {
            queuedTasks.shift().reject(new Error(`${name} finalized before a worker became available`));
        }
        pendingMessages.forEach(({ reject }) => {
            reject(new Error(`${name} finalized before the worker task completed`));
        });
        pendingMessages.clear();
        if (worker) {
            if (workerMessageHandler) {
                worker.removeEventListener("message", workerMessageHandler);
            }
            worker.terminate();
            worker = null;
        }
        workerMessageHandler = null;
        isProcessing = false;
        releaseWorkerScript();
    };
    return {
        finalize,
        processTask,
    };
}

function isCoroutineScript(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.main === "function");
}
/**
 * Merges multiple `CoroutineScript`s into a single composed script suitable for
 * baking into a worker blob via `createTaskRunner`.
 *
 * Each stage is wrapped in an IIFE so that dependency function names
 * and internal variables do not collide across stages.
 */
function mergeCoroutineScripts(scripts) {
    const helpers = Array.from(new Set(scripts.flatMap((s) => s.helpers || [])));
    const stageBodies = scripts
        .map((s, i) => {
        const { code, deps } = serializeScript(s);
        const depsSection = deps.length > 0 ? deps.join(";\n") + ";" : "";
        return `const __stage${i} = (() => {
${depsSection ? '  ' + depsSection.replace(/\n/g, '\n  ') + '\n' : ''}  return (${code});
})();`;
    })
        .reduce((acc, body, i) => `${acc}${i > 0 ? '\n\n' : ''}${body}`, '');
    const composedMain = new Function(`return async function(data) {
      let result = data;
      ${scripts
        .map((_, i) => `result = await __stage${i}(result);`)
        .reduce((acc, line, i) => `${acc}${i > 0 ? "\n      " : ""}${line}`, "")}
      return result;
    };`)();
    const generateScript = (task, taskHelpers) => {
        const allHelpers = Array.from(new Set([...(taskHelpers || []), ...helpers]));
        return buildWorkerScript({
            helpers: [stageBodies, ...allHelpers],
            main: task,
            functions: [],
            runtime: buildCoroutineWorkerRuntime(),
        });
    };
    return { main: composedMain, helpers, generateScript };
}
function compose(...scripts) {
    const workerScripts = [];
    const taskRunners = [];
    for (const s of scripts) {
        if (isCoroutineScript(s)) {
            workerScripts.push(s);
        }
        else if (s && typeof s.processTask === "function") {
            taskRunners.push(s);
        }
    }
    let workerRunner = null;
    if (workerScripts.length > 0) {
        const merged = mergeCoroutineScripts(workerScripts);
        workerRunner = createTaskRunner({
            name: "compose",
            config: merged.helpers.length > 0 ? { helpers: merged.helpers } : undefined,
            main: merged.main,
            functions: [],
            generateWorkerScript: (task, _dependencies, workerConfig) => merged.generateScript(task, workerConfig?.helpers),
        });
    }
    const processTask = async (data) => {
        let result = data;
        if (workerRunner) {
            result = await workerRunner.processTask(result);
        }
        for (const runner of taskRunners) {
            result = await runner.processTask(result);
        }
        return result;
    };
    const finalize = async () => {
        const errors = [];
        if (workerRunner) {
            try {
                await workerRunner.finalize();
            }
            catch (e) {
                errors.push(e instanceof Error ? e : new Error(String(e)));
            }
        }
        for (const runner of taskRunners) {
            try {
                await runner.finalize();
            }
            catch (e) {
                errors.push(e instanceof Error ? e : new Error(String(e)));
            }
        }
        if (errors.length > 0) {
            throw errors[0];
        }
    };
    return {
        processTask,
        finalize,
    };
}

/**
 * Builds a receive case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to receive from.
 * @param name Optional identifier for this case.
 * @returns A `SelectReceiveCase`.
 */
const receive = (ch, name) => ({ op: "receive", channel: ch, name });
/**
 * Builds a send case for use with `select(...)`.
 *
 * @template T The channel value type.
 * @param ch The channel to send into.
 * @param value The value to send.
 * @param name Optional identifier for this case.
 * @returns A `SelectSendCase`.
 */
const send = (ch, value, name) => ({ op: "send", channel: ch, value, name });
/**
 * Builds a default case for use with `select(...)`.
 *
 * @param name Optional identifier for this case.
 * @returns A `SelectDefaultCase`.
 */
const otherwise = (name = "default") => ({ op: "default", name });
/**
 * Waits on multiple channel operations simultaneously and returns the first one that is ready.
 *
 * If a default case is provided and no channel operation is immediately available,
 * the default case is selected without blocking.
 *
 * @template T The channel value type.
 * @param cases An array of select cases (receive, send, or default).
 * @param ctx A cancellation context. Defaults to `background()`.
 * @returns A `SelectResult` describing which case was chosen and its value.
 */
/**
 * Fisher-Yates shuffle for randomizing select case evaluation order.
 */
function shuffledIndices(length) {
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
}
async function select(cases, ctx = background()) {
    if (ctx.signal.aborted)
        throw createAbortError(ctx.signal);
    const defaultIndex = cases.findIndex((item) => item.op === "default");
    const channelIndices = cases
        .map((_, i) => i)
        .filter((i) => cases[i].op !== "default");
    const randomOrder = shuffledIndices(channelIndices.length).map((j) => channelIndices[j]);
    // Fast path: check ready cases in random order
    for (const index of randomOrder) {
        const item = cases[index];
        if (item.op === "receive") {
            const result = item.channel.tryReceive();
            if (result) {
                return { index, case: item, op: item.op, name: item.name, value: result.value, ok: result.ok };
            }
        }
        else if (item.op === "send") {
            if (item.channel.closed) {
                throw new ChannelClosedError();
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
            // One registration coordinates all channel contenders for this select call.
            const registration = {
                id: selectId,
                isSettled: () => settled,
                settle: (outcome) => {
                    if (settled)
                        return false;
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
                    if (settled)
                        return false;
                    settled = true;
                    reject(error);
                    return true;
                },
            };
            const onContextAbort = () => {
                registration.reject(createAbortError(ctx.signal));
            };
            ctx.signal.addEventListener("abort", onContextAbort, { once: true });
            cleanupFns.push(() => ctx.signal.removeEventListener("abort", onContextAbort));
            // Register waiters in random order so no channel starves when
            // multiple become ready in the same tick.
            for (const index of randomOrder) {
                if (settled) {
                    break;
                }
                const item = cases[index];
                if (item.op === "default") {
                    continue;
                }
                const internals = item.channel[CHANNEL_INTERNALS];
                if (!internals) {
                    registration.reject(new ContextCancelledError("channel does not support select"));
                    break;
                }
                // Register the case directly with the channel queues so only one branch
                // can win, even when multiple channels become ready in the same tick.
                const meta = { index, caseRef: item, name: item.name };
                const unregister = item.op === "receive"
                    ? internals.registerSelectReceive(registration, meta)
                    : internals.registerSelectSend(item.value, registration, meta);
                cleanupFns.push(unregister);
            }
        });
    }
    finally {
        while (cleanupFns.length > 0) {
            cleanupFns.pop()();
        }
    }
}

/**
 * Registry of request handlers looked up by actor name.
 */
const actorRequestHandlers = new Map();
/**
 * Registers a main-thread request handler for a target actor name.
 * Workers call `utils.outbox.request(name, topic, payload)` — the handler
 * registered for `name` receives the call and returns the response.
 *
 * Register `"main"` to handle requests sent to the main thread.
 */
function registerActorRequestHandler(name, handler) {
    actorRequestHandlers.set(name, handler);
    return () => actorRequestHandlers.delete(name);
}
/**
 * Removes a request handler previously registered for a name.
 */
function unregisterActorRequestHandler(name) {
    actorRequestHandlers.delete(name);
}
/**
 * Creates a typed actor-bus envelope.
 */
function createActorBusMessage(topic, payload, options) {
    return {
        kind: "actor-bus",
        topic,
        payload,
        from: options?.from,
        to: options?.to,
    };
}
/**
 * Checks whether a payload is an actor-bus envelope.
 */
function isActorBusMessage(value) {
    return (typeof value === "object" &&
        value !== null &&
        value.kind === "actor-bus" &&
        typeof value.topic === "string");
}
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
const toErrorMessage = (error, fallback = "Actor request failed") => (error instanceof Error ? error.message : error ? String(error) : fallback);
function postActorResponse(worker, message) {
    worker.postMessage(message);
}
function handleRequest(message, sourceActor, worker) {
    const { workerId, taskId, requestId, payload, topic } = message;
    const targets = normalizeActorBusTargets(message.to);
    if (targets.length !== 1) {
        postActorResponse(worker, {
            workerId,
            taskId,
            requestId,
            type: "error",
            error: "Actor request requires exactly one target",
        });
        return;
    }
    const targetName = targets[0];
    const handler = actorRequestHandlers.get(targetName);
    if (!handler) {
        postActorResponse(worker, {
            workerId,
            taskId,
            requestId,
            type: "error",
            error: `No actor request handler registered for "${targetName}"`,
        });
        return;
    }
    if (!topic) {
        postActorResponse(worker, {
            workerId,
            taskId,
            requestId,
            type: "error",
            error: "Actor request requires a topic",
        });
        return;
    }
    try {
        const result = handler(topic, payload, {
            from: sourceActor.name,
            to: message.to,
            topic,
        });
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
    }
    catch (err) {
        postActorResponse(worker, {
            workerId,
            taskId,
            requestId,
            type: "error",
            error: toErrorMessage(err),
        });
    }
}
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
function actor(name, behavior, initialState, ...helpers) {
    return createActor(name, behavior, initialState, helpers);
}
function createActor(name, behavior, initialState, helpers) {
    if (!name || typeof name !== "string") {
        throw new Error("Actor name must be a non-empty string");
    }
    const functionHelpers = helpers.filter((h) => typeof h === "function");
    const stringHelpers = helpers.filter((h) => typeof h === "string");
    const workerScript = buildWorkerScript({
        helpers: [ACTOR_CONCURRENCY_RUNTIME, ...stringHelpers],
        main: behavior,
        functions: functionHelpers,
        runtime: buildActorWorkerRuntime(),
    });
    const blobUrl = acquireBlobUrl(workerScript);
    const actorWorkerId = 1;
    const actorTaskId = String(actorWorkerId);
    let worker = null;
    let running = false;
    let nextRequestId = 1;
    const pendingRequests = new Map();
    let shutdownPromise = null;
    let finishShutdown = null;
    let shouldReleaseBlobUrl = false;
    let hasReleasedBlobUrl = false;
    worker = new Worker(blobUrl, { type: "module" });
    worker.__id = actorWorkerId;
    running = true;
    let actorRef;
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
    const postToWorker = (target, message) => {
        target.postMessage({
            workerId: actorWorkerId,
            ...message,
        });
    };
    const shutdown = (releaseBlobUrlOnExit) => {
        shouldReleaseBlobUrl ||= releaseBlobUrlOnExit;
        if (shutdownPromise) {
            releaseWorkerScript();
            return shutdownPromise;
        }
        running = false;
        rejectPendingRequests();
        unregisterActorBusTarget(actorRef);
        const activeWorker = worker;
        if (!activeWorker) {
            releaseWorkerScript();
            return Promise.resolve();
        }
        shutdownPromise = new Promise((resolve) => {
            let settled = false;
            const finalizeShutdown = () => {
                if (settled) {
                    return;
                }
                settled = true;
                finishShutdown = null;
                activeWorker.removeEventListener("message", handleMessage);
                activeWorker.removeEventListener("error", handleError);
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
            }
            catch {
                finishShutdown();
            }
        });
        return shutdownPromise;
    };
    const handleMessage = (event) => {
        const msg = event.data;
        const { type, payload, requestId } = msg;
        if (type === "response" && requestId && pendingRequests.has(requestId)) {
            const { resolve } = pendingRequests.get(requestId);
            pendingRequests.delete(requestId);
            resolve(payload);
        }
        else if (type === "error" && requestId && pendingRequests.has(requestId)) {
            const { reject } = pendingRequests.get(requestId);
            pendingRequests.delete(requestId);
            reject(new Error(msg.error ?? "Actor request failed"));
        }
        else if (type === "request") {
            handleRequest(msg, actorRef, worker);
        }
        else if (type === "notify") {
            if (!running) {
                return;
            }
            if (isActorBusMessage(payload)) {
                dispatchActorBusMessage(payload, { fromActor: actorRef });
                return;
            }
            // Non-bus notify payloads are ignored; behaviors receive messages via the inbox listen cycle.
        }
        else if (type === "stopped") {
            running = false;
            rejectPendingRequests();
            if (finishShutdown) {
                finishShutdown();
            }
            else {
                void shutdown(true);
            }
        }
    };
    const handleError = () => {
        // Generic error handler, specific errors are handled within the message handler
    };
    worker.addEventListener("message", handleMessage);
    postToWorker(worker, {
        taskId: actorTaskId,
        payload: initialState,
        type: "init",
    });
    const actor = {
        name,
        get running() {
            return running;
        },
    };
    actorRef = actor;
    registerActorBusTarget(name, actorRef);
    const internals = {
        stop() {
            return shutdown(true);
        },
        post(msg) {
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
        request(topic, msg) {
            if (!worker || !running) {
                return Promise.reject(new Error("Actor stopped"));
            }
            const id = String(nextRequestId++);
            return new Promise((resolve, reject) => {
                pendingRequests.set(id, { resolve, reject });
                postToWorker(worker, {
                    taskId: actorTaskId,
                    payload: msg,
                    requestId: id,
                    type: "request",
                    topic,
                });
            });
        },
    };
    actorInternalsMap.set(actor, internals);
    return actor;
}
const actorBusRegistrationsById = new Map();
const actorBusRegistrationsByActor = new Map();
const actorBusDirectListeners = new Map();
const actorBusListeners = new Set();
const actorInternalsMap = new WeakMap();
function resolveActorTarget(actorOrName) {
    if (typeof actorOrName !== "string") {
        return actorOrName;
    }
    return actorBusRegistrationsById.get(actorOrName)?.actor;
}
function resolveActorBusTarget(to) {
    if (Array.isArray(to)) {
        return to;
    }
    return typeof to === "string" ? to : to.name;
}
const normalizeActorBusTargets = (to) => {
    if (!to) {
        return [];
    }
    return Array.isArray(to) ? [...to] : [to];
};
const warnAsyncActorBusFailure = (scope, error) => {
    console.warn(`${scope} failed:`, error);
};
function deliverActorBusMessage(actor, message) {
    actorInternalsMap.get(actor)?.post(message);
}
function notifyActorBusSubscribers(message) {
    const directHandlers = message.to
        ? normalizeActorBusTargets(message.to)
            .flatMap((name) => [...(actorBusDirectListeners.get(name) ?? [])])
        : [];
    const handlers = [...actorBusListeners, ...directHandlers];
    for (const handler of handlers) {
        Promise.resolve(handler(message)).catch((error) => {
            warnAsyncActorBusFailure("Actor bus subscriber", error);
        });
    }
}
function unregisterActorBusTarget(idOrActor) {
    const registration = typeof idOrActor === "string"
        ? actorBusRegistrationsById.get(idOrActor)
        : actorBusRegistrationsByActor.get(idOrActor);
    if (!registration) {
        return;
    }
    actorBusRegistrationsById.delete(registration.name);
    actorBusRegistrationsByActor.delete(registration.actor);
}
function registerActorBusTarget(name, actor) {
    const existingRegistration = actorBusRegistrationsById.get(name);
    if (existingRegistration && existingRegistration.actor !== actor) {
        throw new Error(`Actor name "${name}" is already registered`);
    }
    unregisterActorBusTarget(actor);
    const registration = {
        actor,
        name,
    };
    actorBusRegistrationsById.set(name, registration);
    actorBusRegistrationsByActor.set(actor, registration);
    return () => unregisterActorBusTarget(actor);
}
function clearActorBusListeners() {
    actorBusDirectListeners.clear();
    actorBusListeners.clear();
    actorRequestHandlers.clear();
}
function dispatchActorBusMessage(message, options) {
    const from = message.from ??
        (options?.fromActor
            ? actorBusRegistrationsByActor.get(options.fromActor)?.name
            : undefined);
    const routedMessage = from && message.from !== from ? { ...message, from } : message;
    notifyActorBusSubscribers(routedMessage);
    const targets = normalizeActorBusTargets(routedMessage.to);
    if (targets.length > 0) {
        const seen = new Set();
        for (const target of targets) {
            if (seen.has(target)) {
                continue;
            }
            seen.add(target);
            const registration = actorBusRegistrationsById.get(target);
            if (registration) {
                deliverActorBusMessage(registration.actor, routedMessage);
            }
        }
        return;
    }
    for (const registration of actorBusRegistrationsById.values()) {
        if (routedMessage.from &&
            !options?.includeSelf &&
            registration.name === routedMessage.from) {
            continue;
        }
        deliverActorBusMessage(registration.actor, routedMessage);
    }
}
/**
 * Main-thread communication utility.
 *
 * Extends the worker-side `utils` structure:
 * - `main.outbox.send(to, topic, payload)` — fire-and-forget bus message
 * - `main.outbox.request(to, topic, payload)` — send request and await response
 * - `main.outbox.stop(actor)` — stop actor and release resources
 * - `main.inbox.subscribe(handler)` — subscribe to all actor-bus messages
 */
const subscribeMainInbox = (handler) => {
    actorBusListeners.add(handler);
    return () => actorBusListeners.delete(handler);
};
const main = {
    outbox: {
        /** Broadcasts a topic payload to every named actor through the actor bus. */
        publish(topic, payload, options) {
            dispatchActorBusMessage(createActorBusMessage(topic, payload, { from: options?.from ?? "main" }), { includeSelf: options?.includeSelf });
        },
        /** Sends a one-way bus message to one or more named actor targets. */
        send(to, topic, payload, options) {
            dispatchActorBusMessage(createActorBusMessage(topic, payload, { from: options?.from ?? "main", to: resolveActorBusTarget(to) }), {});
        },
        /** Sends a request to an actor and awaits the response. */
        request(to, topic, payload) {
            const target = resolveActorTarget(to);
            if (!target) {
                return Promise.reject(new Error(`Unknown actor target "${String(to)}"`));
            }
            return actorInternalsMap.get(target).request(topic, payload);
        },
        /** Stops the actor, terminates its worker, and releases resources. */
        stop(actor) {
            const target = resolveActorTarget(actor);
            if (!target) {
                return Promise.reject(new Error(`Unknown actor target "${String(actor)}"`));
            }
            return actorInternalsMap.get(target).stop();
        },
    },
    inbox: {
        subscribe: subscribeMainInbox,
        clear: () => {
            clearActorBusListeners();
        },
    },
};

function createCoroutineImpl(main, functions, helpers) {
    const runner = createTaskRunner({
        name: "coroutine",
        config: helpers.length > 0 ? { helpers } : undefined,
        main,
        functions,
        generateWorkerScript: (task, dependencies, workerConfig) => buildWorkerScript({
            helpers: workerConfig?.helpers,
            main: task,
            functions: dependencies,
            runtime: buildCoroutineWorkerRuntime(),
        }),
    });
    return {
        processTask: runner.processTask,
        finalize: runner.finalize,
        helpers,
        main,
        functions,
    };
}
function coroutine(main, ...rest) {
    const last = rest[rest.length - 1];
    const hasOptions = typeof last === "object" &&
        last !== null &&
        typeof last !== "function" &&
        !Array.isArray(last);
    const options = (hasOptions ? last : undefined);
    const functions = (hasOptions ? rest.slice(0, -1) : rest);
    return createCoroutineImpl(main, functions, options?.helpers || []);
}

/**
 * Internal compute-only worker pool.
 *
 * Unlike `createTaskRunner()`, this abstraction can create multiple workers
 * for the same baked task and lend them to queued compute submissions.
 */
function createTaskPool({ name, config, main, functions, generateWorkerScript, createMessageHandler, }) {
    const maxWorkers = (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined) || 4;
    const idleWorkers = [];
    const waitingQueue = [];
    const activeWorkers = new Map();
    const pendingMessages = new Map();
    const workerScript = generateWorkerScript(main, functions, config);
    const blobUrl = acquireBlobUrl(workerScript);
    let createdWorkersCount = 0;
    let isFinalizing = false;
    let nextWorkerId = 0;
    const getWorkerId = (worker) => {
        return worker.__id;
    };
    const removeFromIdleWorkers = (worker) => {
        const idleIndex = idleWorkers.findIndex((entry) => entry === worker);
        if (idleIndex >= 0) {
            idleWorkers.splice(idleIndex, 1);
        }
    };
    const createWorker = async () => {
        const workerId = ++nextWorkerId;
        const worker = new Worker(blobUrl, { type: "module" });
        const messageHandler = createMessageHandler
            ? createMessageHandler(worker, pendingMessages)
            : createDefaultMessageHandler(worker, pendingMessages);
        worker.addEventListener("message", messageHandler);
        worker.__id = workerId;
        activeWorkers.set(workerId, worker);
        return worker;
    };
    const checkoutWorker = async () => {
        if (isFinalizing) {
            throw new Error(`${name} is finalizing`);
        }
        if (idleWorkers.length > 0) {
            return idleWorkers.shift();
        }
        if (createdWorkersCount < maxWorkers) {
            createdWorkersCount++;
            try {
                return await createWorker();
            }
            catch (error) {
                createdWorkersCount--;
                throw error instanceof Error ? error : new Error(String(error));
            }
        }
        return new Promise((resolve, reject) => waitingQueue.push({ resolve, reject }));
    };
    const checkinWorker = (worker) => {
        const workerId = getWorkerId(worker);
        if (workerId === undefined || !activeWorkers.has(workerId)) {
            console.warn("Worker not found.");
            return;
        }
        if (isFinalizing) {
            activeWorkers.delete(workerId);
            removeFromIdleWorkers(worker);
            worker.terminate();
            return;
        }
        if (waitingQueue.length > 0) {
            waitingQueue.shift().resolve(worker);
            return;
        }
        idleWorkers.push(worker);
    };
    const submitTask = (worker, data) => {
        const workerId = getWorkerId(worker);
        if (workerId === undefined || !activeWorkers.has(workerId)) {
            throw new Error("Worker not found or is not active");
        }
        const taskId = generateTaskId();
        return new Promise((resolve, reject) => {
            pendingMessages.set(taskId, { workerId, resolve, reject });
            try {
                worker.postMessage({ workerId, taskId, payload: data, type: "task" });
            }
            catch (error) {
                pendingMessages.delete(taskId);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    };
    const processTask = async (value) => {
        const worker = await checkoutWorker();
        try {
            return await submitTask(worker, value);
        }
        finally {
            checkinWorker(worker);
        }
    };
    const finalize = async () => {
        if (isFinalizing) {
            return;
        }
        isFinalizing = true;
        pendingMessages.forEach(({ reject }) => {
            reject(new Error(`${name} finalized before the worker task completed`));
        });
        pendingMessages.clear();
        while (waitingQueue.length > 0) {
            waitingQueue.shift().reject(new Error(`${name} finalized before a worker became available`));
        }
        const workersToTerminate = [...new Set(activeWorkers.values())];
        activeWorkers.clear();
        idleWorkers.length = 0;
        for (const worker of workersToTerminate) {
            worker.terminate();
            releaseBlobUrl(workerScript);
        }
        createdWorkersCount = 0;
        releaseBlobUrl(workerScript);
    };
    return {
        processTask,
        finalize,
    };
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
function compute(main, ...functions) {
    const pool = createTaskPool({
        name: "compute",
        main,
        functions,
        generateWorkerScript: (task, deps, workerConfig) => buildWorkerScript({
            helpers: workerConfig?.helpers,
            main: task,
            functions: deps,
            runtime: buildCoroutineWorkerRuntime(),
        }),
    });
    const run = async (params) => {
        const resolved = isPromiseLike(params) ? await params : params;
        return pool.processTask(resolved);
    };
    run.finalize = () => pool.finalize();
    return run;
}
/**
 * Creates a compute runner from an existing `CoroutineScript`.
 *
 * This is useful when a script should be pooled for throughput instead of run
 * through `coroutine()`'s single dedicated worker.
 */
function computeScript(script) {
    const pool = createTaskPool({
        name: "compute",
        config: script.helpers?.length ? { helpers: script.helpers } : undefined,
        main: script.main,
        functions: script.functions || [],
        generateWorkerScript: (task, deps, workerConfig) => buildWorkerScript({
            helpers: workerConfig?.helpers,
            main: task,
            functions: deps,
            runtime: buildCoroutineWorkerRuntime(),
        }),
    });
    const run = async (params) => {
        const resolved = isPromiseLike(params) ? await params : params;
        return pool.processTask(resolved);
    };
    run.finalize = () => pool.finalize();
    return run;
}

/**
 * Public API Surface of coroutines
 */

/**
 * Generated bundle index. Do not edit.
 */

export { CHANNEL_INTERNALS, ChannelClosedError, ContextCancelledError, actor, background, channel, compose, compute, computeScript, coroutine, createAbortError, createActorBusMessage, isActorBusMessage, main, otherwise, receive, registerActorRequestHandler, select, send, unregisterActorRequestHandler, withCancel, withDeadline, withTimeout };
//# sourceMappingURL=epikodelabs-streamix-coroutines.mjs.map
