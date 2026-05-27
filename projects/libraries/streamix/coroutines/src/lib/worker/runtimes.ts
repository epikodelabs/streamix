/**
 * Standard coroutine worker runtime.
 *
 * Used by `coroutine()`, `compute()`, and `compose()`.
 */
export const buildCoroutineWorkerRuntime = (): string => `
onmessage = async (event) => {
  const { workerId, taskId, payload, type } = event.data;

  if (type !== 'task') {
    return;
  }

  try {
    const result = await __mainTask(payload);
    postMessage({ workerId, taskId, payload: result, type: 'response' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
export const buildActorWorkerRuntime = (): string => `
const __pendingWorkerRequests = new Map();
let __requestCounter = 0;

const __postToMain = (message) => {
  postMessage(message);
};

const __createRequestId = (taskId) => {
  __requestCounter += 1;
  return taskId + ':request:' + __requestCounter;
};

const __requestMain = (workerId, taskId, payload) => {
  return new Promise((resolve, reject) => {
    const requestId = __createRequestId(taskId);
    __pendingWorkerRequests.set(requestId, { resolve, reject });
    __postToMain({ workerId, taskId, requestId, type: 'request', payload });
  });
};

const __createWorkerUtils = (workerId, taskId) => {
  const inbox = __streamixConcurrency.channel();
  const outbox = {
    request: (requestPayload) => __requestMain(workerId, taskId, requestPayload),
    publish: (topic, messagePayload) =>
      __postToMain({
        workerId,
        taskId,
        payload: { kind: 'actor-bus', topic, payload: messagePayload },
        type: 'notify',
      }),
    send: (to, topic, messagePayload) =>
      __postToMain({
        workerId,
        taskId,
        payload: { kind: 'actor-bus', to, topic, payload: messagePayload },
        type: 'notify',
      }),
    sendTo: (to, topic, messagePayload) =>
      __postToMain({
        workerId,
        taskId,
        payload: { kind: 'actor-bus', to, topic, payload: messagePayload },
        type: 'notify',
      }),
  };
  return {
    outbox,
    inbox: {
      listen: (signal) => inbox.receive(signal),
      receive: (signal) => inbox.receive(signal),
      channel: inbox,
    },
    concurrency: __streamixConcurrency,
    send: (messagePayload) => __postToMain({ workerId, taskId, payload: messagePayload, type: 'notify' }),
    request: outbox.request,
    bus: {
      publish: outbox.publish,
      send: outbox.send,
    },
    publish: outbox.publish,
    sendTo: outbox.sendTo,
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
      const message = error instanceof Error ? error.message : String(error);
      if (replyId) {
        __postToMain({ workerId, taskId, type: "error", requestId: replyId, error: message });
      } else {
        __postToMain({ workerId, taskId, type: "notify", payload: { type: "error", error: message } });
      }
    }
  }

  __actorMailbox.close();
  __postToMain({ workerId, taskId, type: "stopped" });
};

onmessage = async (event) => {
  const { workerId, taskId, payload, type, requestId, error } = event.data;

  if (type === "notify") {
    if (__actorRunning) {
      __actorMailbox.send(payload).catch((error) => {
        console.warn("Actor worker failed to enqueue message", error);
      });
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
    return;
  }

  if (type === "request" && !!requestId) {
    __actorMailbox.send({ msg: payload, requestId }).catch((error) => {
      console.warn("Actor worker failed to enqueue request", error);
    });
    return;
  }
};`;
