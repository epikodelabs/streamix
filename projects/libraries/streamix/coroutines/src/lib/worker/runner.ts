import { createTaskPool } from "./pool";
import type { TaskPool, TaskRunner, WorkerPoolConfig } from "./types";

/**
 * Internal helper that wires `createTaskPool` with a `TaskRunner` facade.
 *
 * Both `coroutine()` and `actor()` use this instead of calling `createTaskPool`
 * directly, keeping the abstraction layer free of pool internals.
 */
export function createTaskRunner<T, R>(options: {
  name: string;
  main: Function;
  functions: Function[];
  config?: WorkerPoolConfig;
  generateWorkerScript: (main: Function, functions: Function[], config?: WorkerPoolConfig) => string;
  createMessageHandler?: (worker: Worker, pendingTasks: any) => (event: MessageEvent<any>) => void;
}): TaskRunner<T, R> & { pool: TaskPool<T, R> } {
  const pool = createTaskPool<T, R>({
    name: options.name,
    config: options.config,
    main: options.main,
    functions: options.functions,
    generateWorkerScript: options.generateWorkerScript,
    createMessageHandler: options.createMessageHandler,
  });

  return {
    processTask: pool.processTask,
    finalize: pool.finalize,
    pool,
  };
}
