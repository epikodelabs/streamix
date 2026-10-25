/**
 * The seam between the reactive core and the introspection entry. Core files
 * import the `__streamix*` delegating functions from here; until the
 * `@epikodelabs/streamix/introspection` entry installs the real
 * implementations, every hook is a no-op that preserves the exact value or
 * iterator semantics of an uninstrumented run. Compiled application code
 * imports the same names from the package root, so instrumentation keeps
 * working through the same delegation.
 */
import type { RuntimeOrigin } from './origin';
import { setOriginCapture } from './origin';
import { internalRuntime, installRuntimeDiagnostics } from './runtime';
import { setRuntimeInstrumentationEnabled, isRuntimeInstrumentationEnabled } from './instrumentation';

export { setOriginCapture };
export { setRuntimeInstrumentationEnabled, isRuntimeInstrumentationEnabled };
/** Runtime access for the introspection entry; internal tooling surface. */
export { internalRuntime as __streamixRuntime, installRuntimeDiagnostics };
export type {
  RuntimeNode, RuntimeGraph, StreamixRuntime, ExecutionSpan, FlowExit,
  RuntimeDiagnosticsPort, RuntimeExecutionsPort,
  ExecutionRecordSnapshot, FlowExecutionSnapshot, FlowDiagnosticsState, AtomStateReader, FlowSnapshot,
  NodeDiagnostics, RuntimeInspection,
} from './runtime';
export type { SchedulableNode } from './scheduling';
export type { RuntimeEvent, RuntimeEventKind, RuntimeEventBus } from './events';
export type { RuntimeOrigin } from './origin';

/** Creation-site metadata the compiler attaches to instrumented factory calls. */
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

/** Terminal outcome of one inner-execution lifetime. */
export type StreamixLifetimeOutcome = 'complete' | 'cancel' | 'error' | 'dropped';

/** Span returned by {@link __streamixBeginLifetime}; inert when introspection is off. */
export interface StreamixLifetimeSpan {
  start(): void;
  output(): void;
  finish(outcome: StreamixLifetimeOutcome): void;
}

/** Real implementations installed by the introspection entry. */
export interface StreamixIntrospectionHooks {
  debug<T>(value: T, metadata: StreamixSourceMetadata): T;
  subscribe<T extends { subscribe: (...args: any[]) => any }>(source: T, metadata: StreamixSourceMetadata): T['subscribe'];
  scopeMember(scope: object, key: PropertyKey, value: unknown): void;
  debugDispose(node: object, kind?: string): void;
  beginLifetime(operator: object): StreamixLifetimeSpan | undefined;
  pipeline(result: object, inputs: readonly unknown[]): void;
  operatorExecution(operator: object, iterator: object): void;
  trackOperatorExecution<T>(iterator: AsyncIterator<T>, name?: string, origin?: RuntimeOrigin): AsyncIterator<T>;
}

function identityDebug<T>(value: T): T {
  return value;
}

/** Default hooks: inert, semantics-preserving, zero bookkeeping. */
const hooks: StreamixIntrospectionHooks = {
  debug: identityDebug,
  subscribe(source, _metadata) {
    const subscribe = source.subscribe;
    return ((...args: any[]) => Reflect.apply(subscribe, source, args)) as any;
  },
  scopeMember() {},
  debugDispose() {},
  beginLifetime() { return undefined; },
  pipeline() {},
  operatorExecution() {},
  trackOperatorExecution(iterator) { return iterator; },
};

/** Install the real `__streamix*` implementations; called by the introspection entry's modules at evaluation time. */
export function installStreamixIntrospection(real: Omit<StreamixIntrospectionHooks, 'trackOperatorExecution'>): void {
  hooks.debug = real.debug;
  hooks.subscribe = real.subscribe;
  hooks.scopeMember = real.scopeMember;
  hooks.debugDispose = real.debugDispose;
  hooks.beginLifetime = real.beginLifetime;
  hooks.pipeline = real.pipeline;
  hooks.operatorExecution = real.operatorExecution;
}

/** Install real operator-iterator tracking; separate because it lives in its own entry module. */
export function installStreamixOperatorTracking(track: StreamixIntrospectionHooks['trackOperatorExecution']): void {
  hooks.trackOperatorExecution = track;
}

/** Compiler helper: returns the exact input, preserving overloads and lazy semantics. */
export function __streamixDebug<T>(value: T, metadata: StreamixSourceMetadata): T {
  return hooks.debug(value, metadata);
}

/** Preserve subscribe's receiver/signature and return the original subscription handle. */
export function __streamixSubscribe<T extends { subscribe: (...args: any[]) => any }>(
  source: T, metadata: StreamixSourceMetadata,
): T['subscribe'] {
  return hooks.subscribe(source, metadata);
}

/** Internal hooks are inactive unless an instrumented browser entry enables them. */
export function __streamixScopeMember(scope: object, key: PropertyKey, value: unknown): void {
  hooks.scopeMember(scope, key, value);
}

export function __streamixDebugDispose(node: object, kind?: string): void {
  hooks.debugDispose(node, kind);
}

/** One span per outer emission, or `undefined` while introspection is off. */
export function __streamixBeginLifetime(operator: object): StreamixLifetimeSpan | undefined {
  return hooks.beginLifetime(operator);
}

export function __streamixPipeline(result: object, inputs: readonly unknown[]): void {
  hooks.pipeline(result, inputs);
}

export function __streamixOperatorExecution(operator: object, iterator: object): void {
  hooks.operatorExecution(operator, iterator);
}

/**
 * Observe an operator iterator without changing its pull/push contract; the
 * default passes the iterator through untouched.
 */
export function trackOperatorExecution<T>(iterator: AsyncIterator<T>, name?: string, origin?: RuntimeOrigin): AsyncIterator<T> {
  return hooks.trackOperatorExecution(iterator, name, origin);
}
