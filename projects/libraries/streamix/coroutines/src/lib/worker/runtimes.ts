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
