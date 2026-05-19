import { createOperator, DONE, NEXT, type Operator } from "@epikodelabs/streamix";

/**
 * Message envelope exchanged between the main thread and worker instances.
 */
export type CoroutineMessageType =
  | "task"
  | "response"
  | "error"
  | "request"
  | "data"
  | "progress"
  | "worker-message"
  | "main-message";

/**
 * `taskId` tracks the outer task lifecycle.
 * `requestId` is reserved for nested actor request/response exchanges.
 */
export type CoroutineMessage = {
  workerId: number;
  taskId: string;
  type: CoroutineMessageType;
  payload?: any;
  error?: string;
  requestId?: string;
};

/**
 * Pending task resolvers keyed by worker task id.
 */
export type PendingTaskMap = Map<
  string,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>;

/**
 * Shared worker-script configuration used by both `coroutine` and `actor`.
 */
export type WorkerPoolConfig = {
  /**
   * Raw worker-side snippets injected before serialized helper/task functions.
   */
  helpers?: string[];
};

/**
 * Shared worker-pool operator shape exposed by both public factories.
 */
export type Coroutine<T = any, R = T> = Operator<T, R> & {
  assignTask: (workerId: number, data: T) => Promise<R>;
  processTask: (data: T) => Promise<R>;
  getIdleWorker: () => Promise<{ worker: Worker; workerId: number }>;
  returnWorker: (workerId: number) => void;
  finalize: () => Promise<void>;
  postMessageToWorker: (workerId: number, message: Omit<CoroutineMessage, "workerId">) => void;
};

/**
 * Custom main-thread message handler for worker responses.
 */
export type WorkerMessageHandler = (
  event: MessageEvent<CoroutineMessage>,
  worker: Worker,
  pendingTasks: PendingTaskMap
) => void;

/**
 * Optional hooks for the default main-thread worker message handler.
 */
export type DefaultMessageHandlerOptions = {
  /** Called when the worker sends a request message. */
  onRequest?: (message: CoroutineMessage) => void | Promise<void>;
  /** Called when the worker sends a progress update. */
  onProgress?: (message: CoroutineMessage) => void | Promise<void>;
  /** Called when the worker sends a one-way message. */
  onWorkerMessage?: (message: CoroutineMessage) => void | Promise<void>;
};

/**
 * Internal bootstrap required by transpiled async/generator code inside worker
 * tasks and injected helper functions.
 */
const ASYNC_WORKER_BOOTSTRAP = `var __defProp=Object.defineProperty,__defProps=Object.defineProperties,__getOwnPropDescs=Object.getOwnPropertyDescriptors,__getOwnPropSymbols=Object.getOwnPropertySymbols,__hasOwnProp=Object.prototype.hasOwnProperty,__propIsEnum=Object.prototype.propertyIsEnumerable,__knownSymbol=(r,e)=>(e=Symbol[r])?e:Symbol.for("Symbol."+r),__defNormalProp=(r,e,o)=>e in r?__defProp(r,e,{enumerable:!0,configurable:!0,writable:!0,value:o}):r[e]=o,__spreadValues=(r,e)=>{for(var o in e||={})__hasOwnProp.call(e,o)&&__defNormalProp(r,o,e[o]);if(__getOwnPropSymbols)for(var o of __getOwnPropSymbols(e))__propIsEnum.call(e,o)&&__defNormalProp(r,o,e[o]);return r},__spreadProps=(r,e)=>__defProps(r,__getOwnPropDescs(e)),__async=(r,e,o)=>new Promise((t,n)=>{var a=r=>{try{s(o.next(r))}catch(e){n(e)}},p=r=>{try{s(o.throw(r))}catch(e){n(e)}},s=r=>r.done?t(r.value):Promise.resolve(r.value).then(a,p);s((o=o.apply(r,e)).next())}),__await=function(r,e){this[0]=r,this[1]=e},__asyncGenerator=(r,e,o)=>{var t=(r,e,n,a)=>{try{var p=o[r](e),s=(e=p.value)instanceof __await,l=p.done;Promise.resolve(s?e[0]:e).then(o=>s?t("return"===r?r:"next",e[1]?{done:o.done,value:o.value}:o,n,a):n({value:o,done:l})).catch(r=>t("throw",r,n,a))}catch(y){a(y)}},n=r=>a[r]=e=>new Promise((o,n)=>t(r,e,o,n)),a={};return o=o.apply(r,e),a[__knownSymbol("asyncIterator")] =()=>a,n("next"),n("throw"),n("return"),a};`;

let workerIdentifierCounter = 0;

type WorkerScriptOptions = {
  helpers?: string[];
  main: Function;
  functions: Function[];
  runtime: string;
};

type CreateCoroutineOperatorOptions = {
  name: string;
  config?: WorkerPoolConfig;
  main: Function;
  functions: Function[];
  generateWorkerScript: (main: Function, functions: Function[], config?: WorkerPoolConfig) => string;
  createMessageHandler?: (worker: Worker, pendingTasks: PendingTaskMap) => (event: MessageEvent<CoroutineMessage>) => void;
};

/**
 * Serializes helper and task functions for worker-script injection.
 */
export function serializeFunction(fn: Function): string {
  return fn.toString().replace(/function[\s]*\(/, `function ${fn.name || ""}(`);
}

const joinScriptSections = (sections: string[]): string =>
  sections
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
export function buildWorkerScript({
  helpers,
  main,
  functions,
  runtime,
}: WorkerScriptOptions): string {
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
 * Creates the default main-thread worker message handler.
 */
export function createDefaultMessageHandler(
  _worker: Worker,
  pendingTasks: PendingTaskMap,
  options?: DefaultMessageHandlerOptions
) {
  return (event: MessageEvent<CoroutineMessage>) => {
    const msg = event.data;
    const { taskId, payload, error, type, workerId } = msg;
    const pending = pendingTasks.get(taskId);

    switch (type) {
      case "response":
        if (pending) {
          pendingTasks.delete(taskId);
          pending.resolve(payload);
        }
        break;
      case "error":
        console.warn(`Error received from worker ${workerId} for task ${taskId}:`, error);
        if (pending) {
          pendingTasks.delete(taskId);
          pending.reject(new Error(error ?? "Unknown worker error"));
        }
        break;
      case "request":
        if (options?.onRequest) {
          Promise.resolve(options.onRequest(msg)).catch((hookError) => {
            console.warn("Worker request hook failed:", hookError);
          });
        } else {
          console.warn("Unhandled worker request:", msg);
        }
        break;
      case "progress":
        if (options?.onProgress) {
          Promise.resolve(options.onProgress(msg)).catch((hookError) => {
            console.warn("Worker progress hook failed:", hookError);
          });
        } else {
          console.warn("Unhandled worker progress:", msg);
        }
        break;
      case "worker-message":
        if (options?.onWorkerMessage) {
          Promise.resolve(options.onWorkerMessage(msg)).catch((hookError) => {
            console.warn("Worker message hook failed:", hookError);
          });
        } else {
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
 * Creates a shared worker-pool operator around a generated worker script.
 */
export function createCoroutineOperator<T, R>({
  name,
  config,
  main,
  functions,
  generateWorkerScript,
  createMessageHandler,
}: CreateCoroutineOperatorOptions): Coroutine<T, R> {
  const maxWorkers = (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) || 4;
  const workerPool: { worker: Worker; workerId: number }[] = [];
  const waitingQueue: Array<(entry: { worker: Worker; workerId: number }) => void> = [];
  const activeWorkers = new Map<number, Worker>();
  const pendingMessages: PendingTaskMap = new Map();

  let createdWorkersCount = 0;
  // Caches the blob URL for the first generated script in this operator instance.
  // Assumes main/functions are constant for the lifetime of the operator.
  let blobUrlCache: string | null = null;
  let isFinalizing = false;

  const createWorker = async (): Promise<{ worker: Worker; workerId: number }> => {
    const workerId = ++workerIdentifierCounter;
    const workerBody = generateWorkerScript(main, functions, config);

    if (!blobUrlCache) {
      const blob = new Blob([workerBody], { type: "application/javascript" });
      blobUrlCache = URL.createObjectURL(blob);
    }

    const worker = new Worker(blobUrlCache, { type: "module" });
    const messageHandler = createMessageHandler
      ? createMessageHandler(worker, pendingMessages)
      : createDefaultMessageHandler(worker, pendingMessages);

    worker.addEventListener("message", messageHandler);
    (worker as any).__id = workerId;
    activeWorkers.set(workerId, worker);

    return { worker, workerId };
  };

  const getIdleWorker = async (): Promise<{ worker: Worker; workerId: number }> => {
    if (workerPool.length > 0) return workerPool.shift()!;
    if (createdWorkersCount < maxWorkers) {
      createdWorkersCount++;
      return createWorker();
    }
    return new Promise((resolve) => waitingQueue.push(resolve));
  };

  const returnWorker = (workerId: number): void => {
    const worker = activeWorkers.get(workerId);
    if (!worker) {
      console.warn(`Worker with id ${workerId} not found.`);
      return;
    }
    if (isFinalizing) {
      activeWorkers.delete(workerId);
      worker.terminate();
      return;
    }
    if (waitingQueue.length > 0) {
      const resolve = waitingQueue.shift()!;
      resolve({ worker, workerId });
    } else {
      workerPool.push({ worker, workerId });
    }
  };

  const generateTaskId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  };

  const assignTask = async (workerId: number, data: T): Promise<R> => {
    const worker = activeWorkers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found or is not active`);
    }
    const taskId = generateTaskId();
    return new Promise<R>((resolve, reject) => {
      pendingMessages.set(taskId, { resolve, reject });
      worker.postMessage({ workerId, taskId, payload: data, type: "task" });
    });
  };

  const postMessageToWorker = (workerId: number, message: Omit<CoroutineMessage, "workerId">): void => {
    const worker = activeWorkers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found or is not active`);
    }

    worker.postMessage({ ...message, workerId });
  };

  const processTask = async (value: T): Promise<R> => {
    const { worker, workerId } = await getIdleWorker();
    const taskId = generateTaskId();
    try {
      return await new Promise<R>((resolve, reject) => {
        pendingMessages.set(taskId, { resolve, reject });
        worker.postMessage({ workerId, taskId, payload: value, type: "task" });
      });
    } finally {
      returnWorker(workerId);
    }
  };

  const finalize = async () => {
    if (isFinalizing) return;
    isFinalizing = true;

    pendingMessages.forEach(({ reject }) => {
      reject(new Error(`${name} finalized before the worker task completed`));
    });
    pendingMessages.clear();

    activeWorkers.forEach((worker) => worker.terminate());
    activeWorkers.clear();
    while (workerPool.length > 0) {
      const { worker } = workerPool.pop()!;
      worker.terminate();
    }
    waitingQueue.length = 0;
    if (blobUrlCache) {
      URL.revokeObjectURL(blobUrlCache);
      blobUrlCache = null;
    }
  };

  const operator = createOperator<T, R>(name, function (this: Operator, source) {
    let completed = false;

    return {
      next: async () => {
        while (true) {
          if (completed || isFinalizing) {
            return DONE;
          }

          const result = await source.next();
          if (result.done) {
            completed = true;
            await finalize();
            return DONE;
          }

          const taskResult = await processTask(result.value as T);
          return NEXT(taskResult);
        }
      },
      async return() {
        completed = true;
        await finalize();
        return DONE;
      },
      async throw(err) {
        completed = true;
        await finalize();
        throw err;
      }
    };
  });

  return {
    ...operator,
    finalize,
    assignTask,
    processTask,
    getIdleWorker,
    returnWorker,
    postMessageToWorker,
  } as Coroutine<T, R>;
}
