import type { CoroutineMessage, PendingTaskMap } from "./messages";
import { createDefaultMessageHandler } from "./messages";
import { serializeScript } from "./script";
import { generateTaskId } from "./utils";
import type { GenericPool, TaskPool, WorkerScript } from "./types";

/**
 * Shared worker-script configuration used by both `coroutine` and `actor`.
 */
export type WorkerPoolConfig = {
  /**
   * Raw worker-side snippets injected before serialized helper/task functions.
   */
  helpers?: string[];
};

type WaitingWorkerRequest = {
  resolve: (entry: Worker) => void;
  reject: (error: Error) => void;
};

type PoolOptions = {
  name: string;
  config?: WorkerPoolConfig;
  main: Function;
  functions: Function[];
  generateWorkerScript: (main: Function, functions: Function[], config?: WorkerPoolConfig) => string;
  createMessageHandler?: (worker: Worker, pendingTasks: PendingTaskMap) => (event: MessageEvent<CoroutineMessage>) => void;
};

type GenericPoolOptions = {
  name?: string;
  maxWorkers?: number;
};

let workerIdentifierCounter = 0;

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));



const buildGenericWorkerRuntime = (): string =>
  `const __taskCache = new Map();

onmessage = async (event) => {
  const { workerId, taskId, payload, type, code, deps, helpers } = event.data;
  if (type !== 'task') { return; }

  let fn = __taskCache.get(code);
  if (!fn) {
    const scripts = [...(helpers || []), ...(deps || []), code];
    fn = new Function(scripts.join('\\n'))();
    __taskCache.set(code, fn);
  }

  try {
    const result = await fn(payload);
    postMessage({ workerId, taskId, payload: result, type: 'response' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ workerId, taskId, error: message, type: 'error' });
  }
};`;

function createPoolCore(
  name: string,
  maxWorkers: number,
  createWorker: () => Promise<Worker>
) {
  const workerPool: Worker[] = [];
  const waitingQueue: WaitingWorkerRequest[] = [];
  const activeWorkers = new Map<number, Worker>();
  const pendingMessages: PendingTaskMap = new Map();

  let createdWorkersCount = 0;
  let isFinalizing = false;

  const getWorkerId = (worker: Worker): number | undefined => {
    return (worker as any).__id;
  };

  const rejectPendingTasksForWorker = (worker: Worker, reason: Error) => {
    const workerId = getWorkerId(worker);
    const taskIds = [...pendingMessages.entries()]
      .filter(([, pending]) => pending.workerId === workerId)
      .map(([taskId]) => taskId);

    for (const taskId of taskIds) {
      pendingMessages.get(taskId)?.reject(reason);
      pendingMessages.delete(taskId);
    }
  };

  const satisfyWaitingQueue = () => {
    while (!isFinalizing && waitingQueue.length > 0 && createdWorkersCount < maxWorkers) {
      const pending = waitingQueue.shift()!;
      createdWorkersCount++;
      createWorker().then(
        pending.resolve,
        (error) => {
          createdWorkersCount--;
          pending.reject(toError(error));
        }
      );
    }
  };

  const getIdleWorker = async (): Promise<Worker> => {
    if (isFinalizing) {
      throw new Error(`${name} is finalizing`);
    }
    if (workerPool.length > 0) return workerPool.shift()!;
    if (createdWorkersCount < maxWorkers) {
      createdWorkersCount++;
      try {
        return await createWorker();
      } catch (error) {
        createdWorkersCount--;
        throw toError(error);
      }
    }
    return new Promise((resolve, reject) => waitingQueue.push({ resolve, reject }));
  };

  const returnWorker = (worker: Worker): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      console.warn(`Worker not found.`);
      return;
    }
    if (isFinalizing) {
      activeWorkers.delete(workerId);
      worker.terminate();
      return;
    }
    if (waitingQueue.length > 0) {
      const pending = waitingQueue.shift()!;
      pending.resolve(worker);
    } else {
      workerPool.push(worker);
    }
  };

  const discardWorker = (worker: Worker, reason?: Error): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      console.warn(`Worker not found.`);
      return;
    }

    activeWorkers.delete(workerId);
    worker.terminate();
    rejectPendingTasksForWorker(
      worker,
      reason ?? new Error(`${name} worker ${workerId} failed and was discarded`)
    );

    const pooledIndex = workerPool.findIndex((entry) => entry === worker);
    if (pooledIndex >= 0) {
      workerPool.splice(pooledIndex, 1);
    }

    if (createdWorkersCount > 0) {
      createdWorkersCount--;
    }

    satisfyWaitingQueue();
  };

  const postMessageToWorker = (worker: Worker, message: Omit<CoroutineMessage, "workerId">): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      throw new Error(`Worker not found or is not active`);
    }
    worker.postMessage({ ...message, workerId });
  };

  const finalize = async () => {
    if (isFinalizing) return;
    isFinalizing = true;

    pendingMessages.forEach(({ reject }) => {
      reject(new Error(`${name} finalized before the worker task completed`));
    });
    pendingMessages.clear();

    while (waitingQueue.length > 0) {
      waitingQueue.shift()!.reject(
        new Error(`${name} finalized before a worker became available`)
      );
    }

    activeWorkers.forEach((worker) => worker.terminate());
    activeWorkers.clear();
    while (workerPool.length > 0) {
      const worker = workerPool.pop()!;
      worker.terminate();
    }

    createdWorkersCount = 0;
    isFinalizing = false;
  };

  return {
    getIdleWorker,
    returnWorker,
    discardWorker,
    postMessageToWorker,
    finalize,
    pendingMessages,
    activeWorkers,
    getWorkerId,
  };
}

/**
 * Creates a specialized worker pool with a task baked into the worker blob.
 *
 * Internal — used by `compute()` and `actor()`.
 */
export function createTaskPool<T, R>({
  name,
  config,
  main,
  functions,
  generateWorkerScript,
  createMessageHandler,
}: PoolOptions): TaskPool<T, R> {
  const maxWorkers = (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) || 4;
  let blobUrlCache: string | null = null;

  const core = createPoolCore(
    name,
    maxWorkers,
    async () => {
      const workerId = ++workerIdentifierCounter;
      const workerBody = generateWorkerScript(main, functions, config);

      if (!blobUrlCache) {
        const blob = new Blob([workerBody], { type: "application/javascript" });
        blobUrlCache = URL.createObjectURL(blob);
      }

      const worker = new Worker(blobUrlCache, { type: "module" });
      const messageHandler = createMessageHandler
        ? createMessageHandler(worker, core.pendingMessages)
        : createDefaultMessageHandler(worker, core.pendingMessages);

      worker.addEventListener("message", messageHandler);
      (worker as any).__id = workerId;
      core.activeWorkers.set(workerId, worker);

      return worker;
    }
  );

  const assignTask = async (worker: Worker, data: T): Promise<R> => {
    const workerId = core.getWorkerId(worker);
    if (workerId === undefined || !core.activeWorkers.has(workerId)) {
      throw new Error(`Worker not found or is not active`);
    }
    const taskId = generateTaskId();
    return new Promise<R>((resolve, reject) => {
      core.pendingMessages.set(taskId, { workerId, resolve, reject });
      try {
        worker.postMessage({ workerId, taskId, payload: data, type: "task" });
      } catch (error) {
        core.pendingMessages.delete(taskId);
        reject(toError(error));
      }
    });
  };

  const processTask = async (value: T): Promise<R> => {
    const worker = await core.getIdleWorker();
    const workerId = core.getWorkerId(worker)!;
    const taskId = generateTaskId();
    try {
      return await new Promise<R>((resolve, reject) => {
        core.pendingMessages.set(taskId, { workerId, resolve, reject });
        try {
          worker.postMessage({ workerId, taskId, payload: value, type: "task" });
        } catch (error) {
          core.pendingMessages.delete(taskId);
          reject(toError(error));
        }
      });
    } finally {
      core.returnWorker(worker);
    }
  };

  return {
    getIdleWorker: core.getIdleWorker,
    returnWorker: core.returnWorker,
    discardWorker: core.discardWorker,
    postMessageToWorker: core.postMessageToWorker,
    finalize: core.finalize,
    assignTask,
    processTask,
  };
}

/**
 * Creates a generic worker pool (MIMD).
 *
 * Workers are not preinitialized with a task. Tasks are sent at runtime as
 * serialized function code and compiled inside the worker with `new Function`.
 * Compiled functions are cached per worker by their source code.
 */
export function createPool(options?: GenericPoolOptions): GenericPool {
  const name = options?.name ?? "pool";
  const maxWorkers = options?.maxWorkers ?? ((typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) || 4);
  let blobUrlCache: string | null = null;

  const core = createPoolCore(
    name,
    maxWorkers,
    async () => {
      const workerId = ++workerIdentifierCounter;

      if (!blobUrlCache) {
        const blob = new Blob([buildGenericWorkerRuntime()], { type: "application/javascript" });
        blobUrlCache = URL.createObjectURL(blob);
      }

      const worker = new Worker(blobUrlCache, { type: "module" });
      const messageHandler = createDefaultMessageHandler(worker, core.pendingMessages);

      worker.addEventListener("message", messageHandler);
      (worker as any).__id = workerId;
      core.activeWorkers.set(workerId, worker);

      return worker;
    }
  );

  const processTask = async <T, R>(script: WorkerScript<T, R>, data: T): Promise<R> => {
    const worker = await core.getIdleWorker();
    const workerId = core.getWorkerId(worker)!;
    const taskId = generateTaskId();
    const { code, deps } = serializeScript(script);
    try {
      return await new Promise<R>((resolve, reject) => {
        core.pendingMessages.set(taskId, { workerId, resolve, reject });
        try {
          worker.postMessage({
            workerId,
            taskId,
            payload: data,
            type: "task",
            code,
            deps,
            helpers: script.helpers,
          });
        } catch (error) {
          core.pendingMessages.delete(taskId);
          reject(toError(error));
        }
      });
    } finally {
      core.returnWorker(worker);
    }
  };

  return {
    getIdleWorker: core.getIdleWorker,
    returnWorker: core.returnWorker,
    discardWorker: core.discardWorker,
    postMessageToWorker: core.postMessageToWorker,
    finalize: core.finalize,
    processTask,
  };
}
