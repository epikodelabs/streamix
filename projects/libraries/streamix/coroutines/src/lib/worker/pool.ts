import type { CoroutineMessage, PendingTaskMap } from "./messages";
import { createDefaultMessageHandler } from "./messages";
import type { TaskRunner, WorkerPool } from "./types";

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

let workerIdentifierCounter = 0;

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Creates a standalone worker pool.
 *
 * The returned object exposes low-level worker management (`WorkerPool`)
 * and high-level task processing (`TaskRunner`), but **not** a stream
 * `Operator`.  Use `createOperator` from `@epikodelabs/streamix` to wrap
 * the pool into a pipeable coroutine or actor.
 */
export function createPool<T, R>({
  name,
  config,
  main,
  functions,
  generateWorkerScript,
  createMessageHandler,
}: PoolOptions): WorkerPool<T, R> & TaskRunner<T, R> {
  const maxWorkers = (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) || 4;
  const workerPool: Worker[] = [];
  const waitingQueue: WaitingWorkerRequest[] = [];
  const activeWorkers = new Map<number, Worker>();
  const pendingMessages: PendingTaskMap = new Map();

  let createdWorkersCount = 0;
  let blobUrlCache: string | null = null;
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

  const createWorker = async (): Promise<Worker> => {
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

    return worker;
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

  const generateTaskId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  };

  const assignTask = async (worker: Worker, data: T): Promise<R> => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      throw new Error(`Worker not found or is not active`);
    }
    const taskId = generateTaskId();
    return new Promise<R>((resolve, reject) => {
      pendingMessages.set(taskId, { workerId, resolve, reject });
      try {
        worker.postMessage({ workerId, taskId, payload: data, type: "task" });
      } catch (error) {
        pendingMessages.delete(taskId);
        reject(toError(error));
      }
    });
  };

  const postMessageToWorker = (worker: Worker, message: Omit<CoroutineMessage, "workerId">): void => {
    const workerId = getWorkerId(worker);
    if (workerId === undefined || !activeWorkers.has(workerId)) {
      throw new Error(`Worker not found or is not active`);
    }

    worker.postMessage({ ...message, workerId });
  };

  const processTask = async (value: T): Promise<R> => {
    const worker = await getIdleWorker();
    const workerId = getWorkerId(worker)!;
    const taskId = generateTaskId();
    try {
      return await new Promise<R>((resolve, reject) => {
        pendingMessages.set(taskId, { workerId, resolve, reject });
        try {
          worker.postMessage({ workerId, taskId, payload: value, type: "task" });
        } catch (error) {
          pendingMessages.delete(taskId);
          reject(toError(error));
        }
      });
    } finally {
      returnWorker(worker);
    }
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
    if (blobUrlCache) {
      URL.revokeObjectURL(blobUrlCache);
      blobUrlCache = null;
    }

    createdWorkersCount = 0;
    isFinalizing = false;
  };

  return {
    finalize,
    assignTask,
    processTask,
    getIdleWorker,
    returnWorker,
    discardWorker,
    postMessageToWorker,
  };
}
