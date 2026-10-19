import { DefaultScheduler, getScheduler, type SchedulableNode } from '../lib/runtime/scheduling';
import { internalRuntime, StreamixRuntime, RuntimeExecutions, isRuntimeInstrumentationEnabled, setRuntimeInstrumentationEnabled } from '../lib/runtime/runtime';
import { trackOperatorExecution } from '../lib/runtime/operator-execution';
import { RuntimeEventDispatcher } from '../lib/runtime/events';

function queuedNode(name: string, depth: number, order: string[]): SchedulableNode {
  return { depth, queued: false, flush: () => { order.push(name); } };
}

describe('runtime scheduler ordering and isolation', () => {
  it('ignores stale entries after removal and requeue with a new depth', () => {
    const scheduler = new DefaultScheduler();
    const order: string[] = [];
    const a = queuedNode('a', 0, order), b = queuedNode('b', 1, order), c = queuedNode('c', 2, order);
    scheduler.queueFlush(a); scheduler.queueFlush(b); scheduler.queueFlush(c);
    scheduler.remove(a);
    a.depth = 3;
    scheduler.queueFlush(a);
    scheduler.flush();
    expect(order).toEqual(['b', 'c', 'a']);
    expect(scheduler.pending).toBe(0);
  });

  it('preserves FIFO for equal-depth requeues and immediate flushes', () => {
    const scheduler = new DefaultScheduler();
    const order: string[] = [];
    const a = queuedNode('a', 0, order), b = queuedNode('b', 0, order);
    scheduler.queueFlush(a); scheduler.queueFlush(b);
    scheduler.flushImmediately(a);
    scheduler.queueFlush(a);
    scheduler.flush();
    expect(order).toEqual(['a', 'b', 'a']);
    expect(scheduler.pending).toBe(0);
  });

  it('drains a multi-level heap in stable priority order', () => {
    const scheduler = new DefaultScheduler();
    const order: string[] = [];
    const nodes = Array.from({ length: 64 }, (_, i) => queuedNode(String(i), (i * 17) % 11, order));
    for (const node of nodes) scheduler.queueFlush(node);
    scheduler.flush();
    expect(order).toEqual(nodes.map((node, i) => ({ depth: node.depth, i }))
      .sort((a, b) => a.depth - b.depth || a.i - b.i).map(({ i }) => String(i)));
    expect(scheduler.pending).toBe(0);
  });

  it('isolates transactions, finalizers and schedulers between runtimes', () => {
    const a = new StreamixRuntime(), b = new StreamixRuntime();
    const order: string[] = [];
    expect(a.scheduling).not.toBe(b.scheduling);
    expect(internalRuntime.scheduling.scheduler).toBe(getScheduler());
    a.scheduling.transaction(() => {
      a.scheduling.scheduler.queueFlush(queuedNode('a', 0, order));
      b.scheduling.scheduler.queueFlush(queuedNode('b', 0, order));
      a.scheduling.finalizeAfterTransaction(() => { order.push('finalize a'); });
      b.scheduling.scheduler.flush();
      a.scheduling.scheduler.flush();
      expect(order).toEqual(['b']);
      expect(b.scheduling.transactionDepth).toBe(0);
    });
    expect(order).toEqual(['b', 'finalize a', 'a']);
  });

  it('rechecks graph membership when an earlier invalidation removes an edge', () => {
    const runtime = new StreamixRuntime();
    const source = {}, a = {}, b = {};
    const calls: string[] = [];
    runtime.dependencies(a, [source]); runtime.dependencies(b, [source]);
    runtime.onInvalidate(a, () => { calls.push('a'); runtime.dependencies(b, []); });
    runtime.onInvalidate(b, () => { calls.push('b'); });
    runtime.changed(source);
    expect(calls).toEqual(['a']);
    expect(runtime.graph.hasDependency(b, source)).toBe(false);
    expect(runtime.graph.dependencyCount(a)).toBe(1);
    expect(runtime.graph.dependentCount(source)).toBe(1);
  });
});

describe('runtime diagnostics costs and accounting', () => {
  let enabled: boolean;
  beforeEach(() => { enabled = isRuntimeInstrumentationEnabled(); setRuntimeInstrumentationEnabled(true); });
  afterEach(() => { setRuntimeInstrumentationEnabled(enabled); });

  it('accounts for a replaced execution and ignores its late completion', () => {
    const executions = new RuntimeExecutions(), node = {};
    const first = executions.start(node), second = executions.start(node);
    executions.finish(node, first, 'complete');
    executions.finish(node, second, 'complete');
    expect(executions.snapshot()).toEqual(jasmine.objectContaining({ started: 2, cancelled: 1, completed: 1, active: 0 }));
  });

  it('does not let disabled starts reuse an active token', () => {
    const executions = new RuntimeExecutions(), node = {};
    const active = executions.start(node);
    setRuntimeInstrumentationEnabled(false);
    const skipped = executions.start(node);
    executions.finish(node, skipped, 'cancel');
    expect(executions.snapshot().active).toBe(1);
    setRuntimeInstrumentationEnabled(true);
    executions.finish(node, active, 'complete');
    expect(executions.snapshot().active).toBe(0);
  });

  it('clears current errors on restart while retaining historical failure', () => {
    const executions = new RuntimeExecutions(), node = {}, error = new Error('failed');
    const first = executions.start(node);
    executions.finish(node, first, 'error', error);
    expect(executions.describe(node)?.error).toBe(error);
    const second = executions.start(node);
    expect(executions.describe(node)?.error).toBeUndefined();
    executions.finish(node, second, 'complete');
    expect(executions.describe(node)?.lastError).toBe(error);
    expect(executions.describe(node)?.error).toBeUndefined();
  });

  it('does not wrap operator methods when accounting and observers are disabled', () => {
    setRuntimeInstrumentationEnabled(false);
    // Inspector listeners may exist in the shared browser runtime; use a scoped spy.
    spyOnProperty(internalRuntime.events, 'observed', 'get').and.returnValue(false);
    const next = () => Promise.resolve({ done: true as const, value: undefined });
    const iterator = { next };
    expect(trackOperatorExecution(iterator)).toBe(iterator);
    expect(iterator.next).toBe(next);
  });

  it('does not read or copy an event when no observer exists', () => {
    const events = new RuntimeEventDispatcher();
    const event = { node: {}, generation: 1, kind: 'next' as const, get value(): unknown { throw new Error('copied'); } };
    expect(() => events.publish(event)).not.toThrow();
  });
});
