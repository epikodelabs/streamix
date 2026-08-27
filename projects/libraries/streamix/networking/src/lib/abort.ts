export function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal.reason);
  }
}

export function onAbort(
  signal: AbortSignal,
  listener: (reason: unknown) => void,
): () => void {
  if (signal.aborted) {
    listener(signal.reason);
    return () => {};
  }

  const handler = () => listener(signal.reason);
  signal.addEventListener('abort', handler, { once: true });
  return () => signal.removeEventListener('abort', handler);
}

export function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const active = signals.filter(Boolean);
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0];

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(active);
  }

  const controller = new AbortController();
  const cleanups = active.map((signal) =>
    onAbort(signal, (reason) => {
      if (!controller.signal.aborted) controller.abort(reason);
    }),
  );

  controller.signal.addEventListener(
    'abort',
    () => cleanups.forEach((cleanup) => cleanup()),
    { once: true },
  );

  return controller.signal;
}

export function raceAbort<T>(
  signal: AbortSignal,
  value: PromiseLike<T>,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError(signal.reason));
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = onAbort(signal, (reason) => reject(abortError(reason)));

    Promise.resolve(value).then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
