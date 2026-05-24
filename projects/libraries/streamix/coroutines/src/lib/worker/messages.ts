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
  /** Serialized function source (used by generic pools). */
  code?: string;
  /** Serialized helper function sources (used by generic pools). */
  deps?: string[];
};

/**
 * Pending task resolvers keyed by worker task id.
 */
export type PendingTaskMap = Map<
  string,
  { workerId: number; resolve: (value: any) => void; reject: (error: Error) => void }
>;

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
