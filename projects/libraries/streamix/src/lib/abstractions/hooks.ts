export type PipeStreamHookContext = {
  streamId: string;
  streamName?: string;
  subscriptionId: string;
  source: AsyncIterator<any>;
  operators: any[];
};

export type PipeStreamHookResult = {
  source?: AsyncIterator<any>;
  operators?: any[];
  final?: (iterator: AsyncIterator<any>) => AsyncIterator<any>;
};

export type StreamRuntimeHooks = {
  onCreateStream?: (info: {
    id: string;
    name?: string;
  }) => void;

  onPipeStream?: (
    ctx: PipeStreamHookContext
  ) => PipeStreamHookResult | void;
};

const HOOKS_KEY = "__STREAMIX_RUNTIME_HOOKS__";

let streamIdCounter = 0;
let subscriptionIdCounter = 0;

export function generateStreamId(): string {
  return `str_${++streamIdCounter}`;
}

export function generateSubscriptionId(): string {
  return `sub_${++subscriptionIdCounter}`;
}

export function registerRuntimeHooks(hooks: StreamRuntimeHooks): void {
  (globalThis as any)[HOOKS_KEY] = hooks;
}

export function getRuntimeHooks(): StreamRuntimeHooks | null {
  return ((globalThis as any)[HOOKS_KEY] ?? null) as StreamRuntimeHooks | null;
}
