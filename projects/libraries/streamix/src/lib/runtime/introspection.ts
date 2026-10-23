import { internalRuntime } from './runtime';
import { setRuntimeInstrumentationEnabled } from './diagnostics';
import { streamixDevtoolsEnabled, streamixDevtoolsSnapshot, subscribeStreamixDevtools, type StreamixDevtoolsEvent } from './devtools';

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
/** Constant-space counters for events observed since this object was instrumented. */
export interface StreamixEmissionMetrics {
  readonly total: number;
  readonly errors: number;
  readonly completed: number;
  readonly cancelled: number;
}
export interface StreamixObjectDetails {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly source: StreamixSourceMetadata;
  readonly state: string;
  readonly value: string;
  readonly subscribers: number;
  readonly emitted: number;
  readonly innerLifetimes: readonly StreamixOperatorLifetime[];
  readonly metrics: StreamixEmissionMetrics;
  readonly owner?: number;
  readonly target?: number;
  readonly dependencies: readonly number[];
  readonly consumers: readonly number[];
  readonly composition: readonly number[];
  readonly pipeline?: boolean;
  readonly pipedSource?: boolean;
  readonly members: readonly { name: string; id?: number; state: string }[];
  readonly error?: string;
}
export interface StreamixEmissionLifetime {
  readonly id: number;
  readonly emission: number;
  readonly durationMs: number;
  readonly queueMs: number;
  readonly firstOutputMs?: number;
  readonly outputs: number;
  readonly outcome: 'complete' | 'cancel' | 'error' | 'dropped';
}
export interface StreamixLifetimeOperator {
  readonly id: number;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}
export interface StreamixOperatorLifetime {
  readonly operator: StreamixLifetimeOperator;
  readonly lifetime: StreamixEmissionLifetime;
}
export interface StreamixLifetimeSpan {
  start(): void;
  output(): void;
  finish(outcome: StreamixEmissionLifetime['outcome']): void;
}
export interface StreamixInspectionEvent { readonly id: number; readonly name: string; readonly kind: string; readonly time: number; readonly objectKind?: StreamixSourceMetadata['kind']; readonly ownerName?: string; readonly emission?: number; readonly lifetime?: StreamixEmissionLifetime; readonly operator?: StreamixLifetimeOperator; readonly pullMs?: number; readonly value?: string; readonly error?: string; }
export interface StreamixInspectorAPI {
  inspect(filter?: StreamixInspectionFilter): readonly StreamixObjectDetails[];
  details(id: number): StreamixObjectDetails | undefined;
  observe(callback: (event: StreamixInspectionEvent) => void): () => void;
  trace(): readonly StreamixInspectionEvent[];
}
declare global { interface Window { __streamix?: StreamixInspectorAPI; } }

type Entry = { id: number; ref: WeakRef<object>; source: StreamixSourceMetadata; owner?: number; composition: number[]; innerLifetimes?: Map<number, StreamixOperatorLifetime>; inputs?: number; metrics: { total: number; errors: number; completed: number; cancelled: number }; latest?: string; state?: string; target?: number; subscriptions?: Set<number> };
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
const pipelineUsers = new WeakMap<object, Set<number>>();
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
function publish(entry: Entry, kind: string, value?: unknown, error?: unknown, pullMs?: number, count?: number): void {
  const emission = count ?? entry.metrics.total;
  const event = Object.freeze({ id: entry.id, name: entry.source.name, kind, time: Date.now(), objectKind: entry.source.kind,
    ...(pullMs === undefined ? {} : { pullMs }),
    ...((kind === 'next' || kind === 'change') && emission > 0 ? { emission } : {}),
    ...(value !== undefined ? { value: streamixPreview(value) } : {}),
    ...(error !== undefined ? { error: error instanceof Error ? error.message.slice(0, 240) : streamixPreview(error) } : {}) });
  appendEvent(event);
}
function appendEvent(event: StreamixInspectionEvent): void {
  pruneEntries();
  events.push(event);
  if (events.length > 1000) events.shift();
  for (const listener of [...listeners]) { try { listener(event); } catch { /* observer isolation */ } }
}

function immutableMetadata(source: StreamixSourceMetadata): StreamixSourceMetadata {
  return Object.freeze({ ...source, ...(source.members ? { members: Object.freeze(Object.fromEntries(
    Object.entries(source.members).map(([key, value]) => [key, immutableMetadata(value)]))) } : {}) });
}
function idOf(node: object): number | undefined { return identities.get(node)?.id; }
function ids(nodes: Iterable<object>): number[] { return [...nodes].map(idOf).filter((id): id is number => id !== undefined); }
function recordEmission(entry: Entry): void { entry.metrics.total++; }
/** One outcome into an entry's counters; used for record-less nodes and definition aggregates. */
function recordOutcome(entry: Entry, kind: string): void {
  if (kind === 'next') recordEmission(entry);
  else if (kind === 'error') entry.metrics.errors++;
  else if (kind === 'complete') entry.metrics.completed++;
  else if (kind === 'cancel') entry.metrics.cancelled++;
}
function emissionMetrics(entry: Entry): StreamixEmissionMetrics {
  return Object.freeze({ ...entry.metrics });
}
function details(id: number): StreamixObjectDetails | undefined {
  const entry = entries.get(id);
  const node = entry?.ref.deref() as any;
  if (!entry || !node || (entry.source.kind === 'scope' ? node._disposed === true : node.disposed === true || (entry.source.kind === 'subscription' && node.unsubscribed === true))) { entries.delete(id); return undefined; }
  const cached = internalRuntime.diagnostics.atomState(node);
  const execution = internalRuntime.diagnostics.executions.describe(node);
  const flow = internalRuntime.diagnostics.flowState(node);
  const raw = entry.source.kind === 'scope' ? node._rawState ?? {} : {};
  // Record-backed nodes take their counters from the runtime's own record;
  // record-less nodes (atoms, deriveds, definitions) use the ledger counters.
  const metrics = execution
    ? Object.freeze({ total: execution.emitted, errors: execution.errors, completed: execution.completed, cancelled: execution.cancelled })
    : emissionMetrics(entry);
  return Object.freeze({ id, name: entry.source.kind !== 'operator' && typeof node !== 'function' && typeof node.name === 'string' ? node.name : entry.source.name,
    kind: entry.source.kind, source: entry.source,
    state: entry.source.kind === 'subscription' ? 'subscribed' : execution?.active ? (flow?.awaitingNext ? 'awaiting source' : 'running')
      : execution?.lastExit ?? entry.state ?? (flow?.started === false ? 'idle' : cached?.hasValue ? 'ready' : 'unevaluated'),
    value: entry.source.kind === 'subscription' ? 'subscription handle' : cached?.hasValue ? streamixPreview(cached.value) : entry.latest ?? (entry.source.kind === 'scope' ? 'scope' : 'unevaluated'),
    subscribers: flow?.subscribers ?? cached?.subscribers ?? 0, emitted: metrics.total,
    metrics,
    innerLifetimes: Object.freeze([...(entry.innerLifetimes?.values() ?? [])].sort((a, b) =>
      a.operator.file.localeCompare(b.operator.file) || a.operator.line - b.operator.line ||
      a.operator.column - b.operator.column || a.operator.id - b.operator.id)),
    target: entry.target,
    owner: entry.owner ?? (object(node.parent) ? idOf(node.parent) : undefined),
    dependencies: Object.freeze(ids(internalRuntime.graph.dependencies(node))),
    consumers: Object.freeze([...ids(internalRuntime.graph.dependents(node)), ...entry.subscriptions ?? []]),
    composition: Object.freeze([...entry.composition]),
    pipeline: pipelines.has(node),
    pipedSource: isPipedSource(node),
    members: Object.freeze(Object.keys(raw).map(key => ({ name: key, id: object(raw[key]) ? idOf(raw[key]) : undefined,
      state: object(raw[key]) && idOf(raw[key]) !== undefined ? 'materialized' : typeof raw[key] === 'function' ? 'method' : 'unevaluated' }))),
    error: cached?.error !== undefined ? (cached.error instanceof Error ? cached.error.message : streamixPreview(cached.error))
      : execution?.error !== undefined ? streamixPreview(execution.error) : undefined,
  });
}
export const streamixInspector: StreamixInspectorAPI = Object.freeze({
  inspect: (filter: StreamixInspectionFilter = {}) => {
    if (enabled) for (const { node } of internalRuntime.diagnostics.flows(internalRuntime.graph)) discoverFlow(node);
    return [...entries.keys()].map(details).filter((row): row is StreamixObjectDetails =>
    !!row && (!filter.name || row.name.includes(filter.name)) && (!filter.file || row.source.file.includes(filter.file)) &&
    (!filter.kind || row.kind === filter.kind));
  },
  details,
  observe: (callback: (event: StreamixInspectionEvent) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  trace: () => Object.freeze([...events]),
});

/** Marker identity for events that describe no runtime node. */
const devtoolsTraceNode: object = { kind: 'devtools' };

/** Called only by instrumented entry points; does nothing in production or SSR. */
export function enableStreamixIntrospection(): void {
  if (enabled || !streamixDevtoolsEnabled || typeof window === 'undefined' || typeof document === 'undefined') return;
  enabled = true;
  // The introspection flag is the single dev activation switch: it must also
  // arm runtime instrumentation, or flows created before/without accounting
  // never register (flowStates feeds discovery) and are invisible to the
  // inspector. Enable runs before application bootstrap in the virtual main.
  setRuntimeInstrumentationEnabled(true);
  window.__streamix = streamixInspector;
  // One subscription over the single runtime bus: graph lifecycle, execution
  // lifecycle, and devtools traces all arrive here in order.
  internalRuntime.events.observe(event => {
    if (event.kind === 'flow' && !identities.has(event.node)) discoverFlow(event.node);
    const entry = identities.get(event.node);
    if (!entry) {
      // Events without a runtime node (devtools read/write/render lines) are
      // trace-only. Coordinator transport never reaches this bus; sources
      // deliver straight into their own coordinator buffers.
      if (event.label !== undefined) {
        appendEvent(Object.freeze({ id: 0, name: event.label.slice(0, 240), kind: event.kind, time: Date.now(),
          ...(event.value !== undefined ? { value: String(event.value).slice(0, 240) } : {}) }));
      }
      return;
    }
    switch (event.kind) {
      case 'register':
      case 'dependencies':
      case 'flow':
        publish(entry, event.kind);
        return;
      case 'dispose':
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
        return;
      case 'change':
        if ((entry.source.kind === 'atom' || entry.source.kind === 'derived') && !internalRuntime.diagnostics.flowState(event.node)) {
          recordEmission(entry);
        }
        // Flow and source entries publish every emission as an execution
        // 'next' event with the value. Their valueless 'change' would
        // duplicate each emission and let an always-ticking source flood the
        // trace with counter lines.
        if (entry.source.kind !== 'flow' && entry.source.kind !== 'source') publish(entry, 'change');
        return;
      case 'next':
      case 'complete':
      case 'cancel':
      case 'error': {
        entry.state = event.kind;
        // Nodes with an execution record are counted by the runtime itself;
        // the browser ledger counts only record-less nodes and mirrors the
        // aggregate onto the operator definition entry.
        const record = internalRuntime.diagnostics.executions.describe(event.node);
        if (!record) recordOutcome(entry, event.kind);
        if (event.kind === 'next') entry.latest = streamixPreview(event.value);
        const definition = definitions.get(event.node);
        if (definition) {
          recordOutcome(definition, event.kind);
          definition.state = event.kind === 'next' ? 'running' : event.kind;
          definition.latest = entry.latest;
        }
        publish(entry, event.kind, event.value, event.error ?? record?.error, event.pullMs, record?.emitted);
        if (event.kind !== 'next' && entry.source.kind === 'operator') entries.delete(entry.id);
        return;
      }
    }
  });
  // Framework bridge events enter the same bus; seed the trace history first
  // so events recorded before introspection was enabled are not lost.
  const bridge = (event: StreamixDevtoolsEvent) =>
    internalRuntime.events.publish({ kind: event.type, node: devtoolsTraceNode, label: event.source });
  for (const event of streamixDevtoolsSnapshot()) bridge(event);
  subscribeStreamixDevtools(bridge);
}

let lifetimeSequence = 0;
/**
 * One terminal snapshot per outer emission; no payloads or unbounded history.
 * Measures wall-clock time from operator receipt, including projection and
 * downstream pull waits. Upstream buffering before receipt is not observable.
 * Dropped values have no inner execution; queueMs is time awaiting admission.
 */
export function __streamixBeginLifetime(operator: object): StreamixLifetimeSpan | undefined {
  if (!enabled) return undefined;
  const entry = identities.get(operator);
  if (!entry) return undefined;
  const name = Object.getOwnPropertyDescriptor(operator, 'name')?.value;
  const operatorInfo: StreamixLifetimeOperator = Object.freeze({ id: entry.id,
    name: typeof name === 'string' ? name : entry.source.name,
    file: entry.source.file, line: entry.source.line, column: entry.source.column });
  const id = ++lifetimeSequence;
  const emission = entry.inputs = (entry.inputs ?? 0) + 1;
  const received = performance.now();
  let started: number | undefined, firstOutputMs: number | undefined;
  let outputs = 0, finished = false;
  return {
    start() { if (!finished) started ??= performance.now(); },
    output() {
      if (finished) return;
      firstOutputMs ??= Math.max(0, performance.now() - received);
      outputs++;
    },
    finish(outcome) {
      if (finished) return;
      finished = true;
      const end = performance.now();
      const lifetime = Object.freeze({ id, emission, durationMs: Math.max(0, end - received),
        queueMs: Math.max(0, (started ?? end) - received), firstOutputMs, outputs, outcome });
      const summary = Object.freeze({ operator: operatorInfo, lifetime });
      (entry.innerLifetimes ??= new Map()).set(entry.id, summary);
      const seen = new Set<number>([entry.id]);
      let owner = entry.owner === undefined ? undefined : entries.get(entry.owner);
      while (owner && !seen.has(owner.id)) {
        (owner.innerLifetimes ??= new Map()).set(entry.id, summary);
        seen.add(owner.id);
        owner = owner.owner === undefined ? undefined : entries.get(owner.owner);
      }
      appendEvent(Object.freeze({ id: entry.id, name: entry.source.name, kind: 'lifetime', time: Date.now(), objectKind: entry.source.kind,
        ownerName: entry.owner === undefined ? undefined : entries.get(entry.owner)?.source.name, emission, lifetime, operator: operatorInfo }));
    },
  };
}

function isPipedSource(node: object): boolean {
  if (pipelines.has(node)) return false;
  const users = pipelineUsers.get(node);
  if (!users) return false;
  for (const id of users) {
    const pipeline = entries.get(id)?.ref.deref();
    if (!pipeline || (pipeline as { disposed?: boolean }).disposed) users.delete(id);
  }
  return users.size > 0;
}

/** Discover runtime-created flows without evaluating or subscribing to them. */
function discoverFlow(node: object): void {
  if (identities.has(node)) return;
  const origin = internalRuntime.diagnostics.originOf(node);
  const name = typeof (node as { name?: unknown }).name === 'string'
    ? (node as { name: string }).name : origin?.fn ?? 'flow';
  __streamixDebug(node, { kind: 'flow', name: name || 'flow',
    file: origin?.file ?? '[runtime]', line: origin?.line ?? 0, column: origin?.column ?? 0 });
}

/** Compiler helper: returns the exact input, preserving overloads and lazy semantics. */
export function __streamixDebug<T>(value: T, metadata: StreamixSourceMetadata): T {
  if (!enabled) enableStreamixIntrospection();
  if (!enabled || !object(value)) return value;
  let entry = identities.get(value);
  const listed = entry !== undefined && entries.has(entry.id);
  if (!entry) {
    entry = { id: ++sequence, ref: new WeakRef(value), source: immutableMetadata(metadata), composition: [],
      metrics: { total: 0, errors: 0, completed: 0, cancelled: 0 } };
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
  // One register line when the object enters the listing; later calls only
  // refresh metadata and must not re-announce it in the trace.
  if (!listed) publish(entry, 'register');
  return value;
}

/** Internal hooks are inactive unless an instrumented browser entry enables them. */
export function __streamixScopeMember(scope: object, key: PropertyKey, value: unknown): void {
  if (!enabled || !object(value)) return;
  const parent = identities.get(scope);
  if (!parent || (!(value as any).type || !['atom', 'scope'].includes((value as any).type))) return;
  const source = parent.source.members?.[String(key)] ?? { ...parent.source, members: undefined, name: parent.source.name + '.' + String(key),
    kind: (value as any).type === 'scope' ? 'scope' as const : 'atom' as const };
  const kind = (value as any).type === 'scope' ? 'scope' : internalRuntime.diagnostics.flowState(value) ? 'flow'
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
  for (const input of pipelines.get(node) ?? []) pipelineUsers.get(input)?.delete(entry.id);
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
  if (!enabled) return;
  const previous = pipelines.get(result);
  const previousId = identities.get(result)?.id;
  if (previousId !== undefined) for (const input of previous ?? []) pipelineUsers.get(input)?.delete(previousId);
  pipelines.set(result, inputs.filter(object));
  discoverFlow(result);
  const entry = identities.get(result);
  if (entry) {
    for (const input of pipelines.get(result) ?? []) {
      let users = pipelineUsers.get(input);
      if (!users) pipelineUsers.set(input, users = new Set());
      users.add(entry.id);
    }
    __streamixDebug(result, entry.source);
  }
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
