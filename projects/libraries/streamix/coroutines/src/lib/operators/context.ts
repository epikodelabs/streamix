export class ContextCancelledError extends Error {
  constructor(message = "context cancelled") {
    super(message);
    this.name = "ContextCancelledError";
  }
}

export type Context = {
  readonly signal: AbortSignal;
  readonly done: Promise<void>;
  readonly reason: unknown;
  value<T = unknown>(key: unknown): T | undefined;
  withValue<T = unknown>(key: unknown, value: T): Context;
};

export type Cancel = (reason?: unknown) => void;

type ContextState = {
  controller: AbortController;
  values: Map<unknown, unknown>;
  parent?: Context;
};

export const createAbortError = (signal?: AbortSignal): Error => {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new ContextCancelledError(reason ? String(reason) : undefined);
};

const createContextFromState = (state: ContextState): Context => {
  const done = new Promise<void>((resolve) => {
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
    value<T = unknown>(key: unknown): T | undefined {
      if (state.values.has(key)) return state.values.get(key) as T;
      return state.parent?.value<T>(key);
    },
    withValue<T = unknown>(key: unknown, value: T): Context {
      const values = new Map<unknown, unknown>();
      values.set(key, value);
      return createContextFromState({
        controller: state.controller,
        values,
        parent: this,
      });
    },
  };
};

export const background = (): Context =>
  createContextFromState({ controller: new AbortController(), values: new Map() });

export function withCancel(parent: Context = background()): [Context, Cancel] {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent.reason ?? new ContextCancelledError());

  if (parent.signal.aborted) {
    onParentAbort();
  } else {
    parent.signal.addEventListener("abort", onParentAbort, { once: true });
  }

  const ctx = createContextFromState({ controller, values: new Map(), parent });
  const cancel: Cancel = (reason = new ContextCancelledError()) => {
    parent.signal.removeEventListener("abort", onParentAbort);
    if (!controller.signal.aborted) controller.abort(reason);
  };
  return [ctx, cancel];
}

export function withTimeout(parent: Context, ms: number): [Context, Cancel] {
  const [ctx, cancel] = withCancel(parent);
  const timer = setTimeout(() => cancel(new ContextCancelledError(`context timeout after ${ms}ms`)), ms);
  ctx.done.finally(() => clearTimeout(timer));
  return [ctx, cancel];
}

export function withDeadline(parent: Context, deadline: Date | number): [Context, Cancel] {
  const time = typeof deadline === "number" ? deadline : deadline.getTime();
  return withTimeout(parent, Math.max(0, time - Date.now()));
}
