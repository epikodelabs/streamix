import { internalRuntime } from './runtime';
import { streamixDevtoolsEnabled, streamixDevtoolsSnapshot, subscribeStreamixDevtools } from '../devtools';

export interface StreamixSourceMetadata {
  readonly kind: 'scope' | 'atom' | 'derived' | 'flow' | 'operator' | 'source' | 'subscription';
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly enclosing?: string;
  readonly ownerClass?: string;
  readonly field?: string;
  readonly members?: Readonly<Record<string, StreamixSourceMetadata>>;
}
export interface StreamixInspectionFilter { name?: string; file?: string; kind?: string; }
export interface StreamixObjectDetails {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly source: StreamixSourceMetadata;
  readonly state: string;
  readonly value: string;
  readonly subscribers: number;
  readonly emitted: number;
  readonly owner?: number;
  readonly target?: number;
  readonly dependencies: readonly number[];
  readonly consumers: readonly number[];
  readonly composition: readonly number[];
  readonly members: readonly { name: string; id?: number; state: string }[];
  readonly error?: string;
}
export interface StreamixInspectionEvent { readonly id: number; readonly name: string; readonly kind: string; readonly time: number; readonly value?: string; readonly error?: string; }
export interface StreamixInspectorAPI {
  inspect(filter?: StreamixInspectionFilter): readonly StreamixObjectDetails[];
  details(id: number): StreamixObjectDetails | undefined;
  observe(callback: (event: StreamixInspectionEvent) => void): () => void;
  trace(): readonly StreamixInspectionEvent[];
}
declare global { interface Window { __streamix?: StreamixInspectorAPI; } }

type Entry = { id: number; ref: WeakRef<object>; source: StreamixSourceMetadata; owner?: number; composition: number[]; latest?: string; state?: string; emitted?: number; target?: number; subscriptions?: Set<number> };
const identities = new WeakMap<object, Entry>();
const entries = new Map<number, Entry>();
// Finalization releases metadata without retaining the inspected object. The
// incremental sweep also covers environments where collection is delayed.
const finalized = new FinalizationRegistry<number>(id => { entries.delete(id); });
let sweep: IterableIterator<[number, Entry]> | undefined;
function pruneEntries(): void {
  sweep ??= entries.entries();
  for (let count = 0; count < 16; count++) {
    const next = sweep.next();
    if (next.done) { sweep = undefined; break; }
    const [id, entry] = next.value;
    if (!entry.ref.deref()) entries.delete(id);
  }
}
const definitions = new WeakMap<object, Entry>();
const pipelines = new WeakMap<object, readonly object[]>();
const listeners = new Set<(event: StreamixInspectionEvent) => void>();
let sequence = 0;
let enabled = false;
const events: StreamixInspectionEvent[] = [];
const object = (value: unknown): value is object => value !== null && (typeof value === 'object' || typeof value === 'function');

/** Bounded, getter-free previews. Inspecting an object must not execute user getters. */
export function streamixPreview(value: unknown): string {
  const seen = new WeakSet<object>();
  const summarize = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return v.slice(0, 240);
    if (typeof v === 'bigint' || typeof v === 'symbol') return String(v);
    if (typeof v === 'function') return '[function]';
    if (!object(v)) return v;
    if (seen.has(v)) return '[circular]';
    if (depth === 0) return '[object]';
    seen.add(v);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(v).slice(0, 12)) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      result[key] = descriptor && 'value' in descriptor ? summarize(descriptor.value, depth - 1) : '[getter]';
    }
    return result;
  };
  try { return (typeof value === 'string' ? value : JSON.stringify(summarize(value, 2)) ?? String(value)).slice(0, 240); }
  catch { return '[unavailable]'; }
}
function publish(entry: Entry, kind: string, value?: unknown, error?: unknown): void {
  const event = Object.freeze({ id: entry.id, name: entry.source.name, kind, time: Date.now(),
    ...(value !== undefined ? { value: streamixPreview(value) } : {}),
    ...(error !== undefined ? { error: error instanceof Error ? error.message.slice(0, 240) : streamixPreview(error) } : {}) });
  appendEvent(event);
}
function appendEvent(event: StreamixInspectionEvent): void {
  pruneEntries();
  events.push(event);
  if (events.length > 250) events.shift();
  for (const listener of [...listeners]) { try { listener(event); } catch { /* observer isolation */ } }
}

function immutableMetadata(source: StreamixSourceMetadata): StreamixSourceMetadata {
  return Object.freeze({ ...source, ...(source.members ? { members: Object.freeze(Object.fromEntries(
    Object.entries(source.members).map(([key, value]) => [key, immutableMetadata(value)]))) } : {}) });
}
function idOf(node: object): number | undefined { return identities.get(node)?.id; }
function ids(nodes: Iterable<object>): number[] { return [...nodes].map(idOf).filter((id): id is number => id !== undefined); }
function details(id: number): StreamixObjectDetails | undefined {
  const entry = entries.get(id);
  const node = entry?.ref.deref() as any;
  if (!entry || !node || (entry.source.kind === 'scope' ? node._disposed === true : node.disposed === true || (entry.source.kind === 'subscription' && node.unsubscribed === true))) { entries.delete(id); return undefined; }
  const cached = internalRuntime.atomState(node);
  const execution = internalRuntime.executions.describe(node);
  const flow = internalRuntime.flowState(node);
  const raw = entry.source.kind === 'scope' ? node._rawState ?? {} : {};
  return Object.freeze({ id, name: entry.source.kind !== 'operator' && typeof node !== 'function' && typeof node.name === 'string' ? node.name : entry.source.name,
    kind: entry.source.kind, source: entry.source,
    state: entry.source.kind === 'subscription' ? 'subscribed' : execution?.active ? (flow?.awaitingNext ? 'awaiting source' : 'running')
      : execution?.lastExit ?? entry.state ?? (flow?.started === false ? 'idle' : cached?.hasValue ? 'ready' : 'unevaluated'),
    value: entry.source.kind === 'subscription' ? 'subscription handle' : cached?.hasValue ? streamixPreview(cached.value) : entry.latest ?? (entry.source.kind === 'scope' ? 'scope' : 'unevaluated'),
    subscribers: cached?.subscribers ?? flow?.subscribers ?? 0, emitted: execution?.emitted ?? entry.emitted ?? 0,
    target: entry.target,
    owner: entry.owner ?? (object(node.parent) ? idOf(node.parent) : undefined),
    dependencies: Object.freeze(ids(internalRuntime.graph.dependencies(node))),
    consumers: Object.freeze([...ids(internalRuntime.graph.dependents(node)), ...entry.subscriptions ?? []]),
    composition: Object.freeze([...entry.composition]),
    members: Object.freeze(Object.keys(raw).map(key => ({ name: key, id: object(raw[key]) ? idOf(raw[key]) : undefined,
      state: object(raw[key]) && idOf(raw[key]) !== undefined ? 'materialized' : typeof raw[key] === 'function' ? 'method' : 'unevaluated' }))),
    error: cached?.error !== undefined ? (cached.error instanceof Error ? cached.error.message : streamixPreview(cached.error))
      : execution?.error !== undefined ? streamixPreview(execution.error) : undefined,
  });
}
export const streamixInspector: StreamixInspectorAPI = Object.freeze({
  inspect: (filter: StreamixInspectionFilter = {}) => [...entries.keys()].map(details).filter((row): row is StreamixObjectDetails =>
    !!row && (!filter.name || row.name.includes(filter.name)) && (!filter.file || row.source.file.includes(filter.file)) &&
    (!filter.kind || row.kind === filter.kind)),
  details,
  observe: (callback: (event: StreamixInspectionEvent) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  trace: () => Object.freeze([...events]),
});

/** Called only by instrumented entry points; does nothing in production or SSR. */
export function enableStreamixIntrospection(): void {
  if (enabled || !streamixDevtoolsEnabled || typeof window === 'undefined' || typeof document === 'undefined') return;
  enabled = true;
  window.__streamix = streamixInspector;
  const recorded = new WeakSet<object>();
  subscribeStreamixDevtools(() => {
    for (const event of streamixDevtoolsSnapshot()) {
      if (recorded.has(event)) continue;
      recorded.add(event);
      appendEvent(Object.freeze({ id: 0, name: event.source.slice(0, 240), kind: event.type, time: event.time }));
    }
  });
  internalRuntime.observe(event => {
    const entry = identities.get(event.node);
    if (!entry) return;
    if (event.kind === 'dispose') {
      __streamixDebugDispose(event.node);
      pipelines.delete(event.node);
      for (const id of entry.composition) {
        const child = entries.get(id);
        if (child?.owner === entry.id) {
          const other = [...entries.values()].find(candidate => candidate.id !== entry.id && candidate.composition.includes(id));
          if (other) child.owner = other.id;
          else entries.delete(id);
        }
      }
    } else publish(entry, event.kind);
  });
  internalRuntime.events.observe(event => {
    const entry = identities.get(event.node);
    if (!entry) return;
    entry.state = event.kind;
    if (event.kind === 'next') { entry.latest = streamixPreview(event.value); entry.emitted = (entry.emitted ?? 0) + 1; }
    const definition = definitions.get(event.node);
    if (definition) {
      definition.state = event.kind === 'next' ? 'running' : event.kind;
      definition.latest = entry.latest;
      if (event.kind === 'next') definition.emitted = (definition.emitted ?? 0) + 1;
    }
    publish(entry, event.kind, event.value, event.error ?? internalRuntime.executions.describe(event.node)?.error);
    if (event.kind !== 'next' && entry.source.kind === 'operator') entries.delete(entry.id);
  });
}

/** Compiler helper: returns the exact input, preserving overloads and lazy semantics. */
export function __streamixDebug<T>(value: T, metadata: StreamixSourceMetadata): T {
  if (!enabled) enableStreamixIntrospection();
  if (!enabled || !object(value)) return value;
  let entry = identities.get(value);
  if (!entry) {
    entry = { id: ++sequence, ref: new WeakRef(value), source: immutableMetadata(metadata), composition: [] };
    identities.set(value, entry);
    finalized.register(value, entry.id);
    entries.set(entry.id, entry);
  } else { entry.source = immutableMetadata(metadata); entries.set(entry.id, entry); }
  if (metadata.kind === 'scope') {
    const scope = value as any;
    for (const key of Object.keys(scope._rawState ?? {})) __streamixScopeMember(scope, key, scope._rawState[key]);
  }
  const inputs = pipelines.get(value);
  if (inputs) {
    entry.composition = ids(inputs);
    for (const input of inputs) {
      const child = identities.get(input);
      if (child && child.owner === undefined && (child.source.kind === 'operator' || child.source.kind === 'source')) child.owner = entry.id;
    }
  }
  publish(entry, 'register');
  return value;
}

/** Internal hooks are inactive unless an instrumented browser entry enables them. */
export function __streamixScopeMember(scope: object, key: PropertyKey, value: unknown): void {
  if (!enabled || !object(value)) return;
  const parent = identities.get(scope);
  if (!parent || (!(value as any).type || !['atom', 'scope'].includes((value as any).type))) return;
  const source = parent.source.members?.[String(key)] ?? { ...parent.source, members: undefined, name: parent.source.name + '.' + String(key),
    kind: (value as any).type === 'scope' ? 'scope' as const : 'atom' as const };
  const kind = (value as any).type === 'scope' ? 'scope' : internalRuntime.flowState(value) ? 'flow'
    : source.kind === 'source' || identities.get(value)?.source.kind === 'source' ? 'source'
    : typeof (value as any).next === 'function' ? 'atom' : 'derived';
  const members = source.members ?? identities.get(value)?.source.members;
  __streamixDebug(value, { ...source, kind, ...(members ? { members } : {}) });
  identities.get(value)!.owner = parent.id;
}
export function __streamixDebugDispose(node: object, kind = 'dispose'): void {
  if (!enabled) return;
  const entry = identities.get(node);
  if (!entry || !entries.has(entry.id)) return;
  publish(entry, kind);
  entries.delete(entry.id);
  if (entry.target !== undefined) entries.get(entry.target)?.subscriptions?.delete(entry.id);
  for (const id of entry.subscriptions ?? []) {
    const subscription = entries.get(id);
    if (subscription) { publish(subscription, 'unsubscribe'); entries.delete(id); }
  }
  entry.subscriptions?.clear();
}

/** Preserve subscribe's receiver/signature and return the original subscription handle. */
export function __streamixSubscribe<T extends { subscribe: (...args: any[]) => any }>(
  source: T, metadata: StreamixSourceMetadata,
): T['subscribe'] {
  const subscribe = source.subscribe;
  return ((...args: any[]) => {
    const result = Reflect.apply(subscribe, source, args);
    __streamixDebug(result, metadata);
    if (object(result)) {
      const handle = identities.get(result);
      const target = identities.get(source);
      if (handle && target) {
        handle.target = target.id;
        (target.subscriptions ??= new Set()).add(handle.id);
        publish(handle, 'subscription');
        if ((source as any).disposed === true || (result as any).unsubscribed === true) __streamixDebugDispose(result, 'unsubscribe');
      }
    }
    return result;
  }) as T['subscribe'];
}
export function __streamixPipeline(result: object, inputs: readonly unknown[]): void {
  if (enabled) pipelines.set(result, inputs.filter(object));
}
export function __streamixOperatorExecution(operator: object, iterator: object): void {
  if (!enabled) return;
  const definition = identities.get(operator);
  if (!definition) return;
  entries.set(definition.id, definition);
  __streamixDebug(iterator, definition.source);
  const execution = identities.get(iterator)!;
  execution.owner = definition.owner;
  definitions.set(iterator, definition);
}
