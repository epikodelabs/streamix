import { internalRuntime, type RuntimeNode } from '../lib/runtime/runtime';
import { RuntimeExecutions } from '../lib/runtime/diagnostics';
import { getScheduler } from '../lib/runtime/scheduling';
import { setOriginCapture } from '../lib/runtime/origin';
import { atom, derived, flow } from '../lib/atoms/atom';
import { pipe } from '../lib/atoms/pipe';
import { map } from '../lib/operators/map';
import { from } from '../lib/factories';

function tick(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)); }

describe('runtime execution diagnostics records', () => {
  it('keeps a per-node record across start, emission, and finish', () => {
    const executions = new RuntimeExecutions();
    const node = {};
    const token = executions.start(node, 'labels');
    expect(executions.describe(node)).toEqual({
      node, name: 'labels', active: true, runs: 1, emitted: 0, completed: 0, cancelled: 0, errors: 0,
      lastExit: undefined, lastError: undefined,
    });

    executions.next(node, token);
    executions.finish(node, token, 'complete');
    expect(executions.describe(node)).toEqual(jasmine.objectContaining({
      name: 'labels', active: false, runs: 1, emitted: 1, lastExit: 'complete',
    }));
  });

  it('captures the error of a failed execution and counts repeat runs', () => {
    const executions = new RuntimeExecutions();
    const node = {};
    const first = executions.start(node, 'labels');
    executions.finish(node, first, 'error', new Error('boom'));
    const second = executions.start(node, 'labels');
    executions.next(node, second);
    executions.finish(node, second, 'cancel');
    expect(executions.describe(node)).toEqual(jasmine.objectContaining({
      runs: 2, emitted: 1, lastExit: 'cancel', lastError: new Error('boom'),
    }));
  });

  it('ignores stale tokens and unknown nodes', () => {
    const executions = new RuntimeExecutions();
    const node = {};
    const stale = executions.start(node, 'labels');
    const fresh = executions.start(node, 'labels');
    executions.next(node, stale);
    executions.finish(node, stale, 'complete');
    expect(executions.describe(node)).toEqual(jasmine.objectContaining({ active: true, runs: 2, emitted: 0 }));
    executions.finish(node, fresh, 'cancel');
    expect(executions.describe(node)).toEqual(jasmine.objectContaining({ active: false, lastExit: 'cancel' }));
    expect(executions.describe({})).toBeUndefined();
  });

  it('forgets records on demand', () => {
    const executions = new RuntimeExecutions();
    const node = {};
    executions.start(node, 'labels');
    executions.forget(node);
    expect(executions.describe(node)).toBeUndefined();
    expect(executions.snapshotEntries()).toEqual([]);
  });
});

describe('runtime inspection', () => {
  it('reports graph shape, scheduler pending work, and transaction depth', () => {
    // The runtime singleton is shared across the whole suite: assert deltas for
    // this diamond, not absolute counts.
    const baselineNodes = internalRuntime.diagnostics.inspect(internalRuntime).graph.nodes;
    const source = atom(1);
    const left = derived($ => $(source) * 2);
    const right = derived($ => $(source) * 3);
    const total = derived($ => $(left) + $(right));
    total.value; // force evaluation so edges exist
    const mine = new Set<RuntimeNode>([source, left, right, total]);

    let inspection = internalRuntime.diagnostics.inspect(internalRuntime);
    expect(inspection.graph.nodes - baselineNodes).toBe(4);
    expect(inspection.scheduler.transactionDepth).toBe(0);
    const nodes = inspection.nodes.filter(node => mine.has(node.node));
    expect(nodes.length).toBe(4);
    expect(nodes.map(node => node.depth).sort()).toEqual([0, 1, 1, 2]);

    internalRuntime.scheduling.transaction(() => {
      source.set(5);
      inspection = internalRuntime.diagnostics.inspect(internalRuntime);
      expect(inspection.scheduler.transactionDepth).toBe(1);
      // The source has no user subscribers, so it does not queue; its two
      // derived children queue and total joins during the depth-ordered drain.
      expect(inspection.scheduler.pending).toBe(2);
      expect(inspection.nodes.filter(node => node.queued).length).toBe(2);
    });
    expect(internalRuntime.diagnostics.inspect(internalRuntime).scheduler.pending).toBe(0);
    expect(total.value).toBe(25);
  });

  it('labels operator executions and clears their records on finish', async () => {
    const values: number[] = [];
    const iterable = pipe(from([1, 2, 3]), map(value => value * 10));
    for await (const value of iterable) values.push(value);
    expect(values).toEqual([10, 20, 30]);

    const record = internalRuntime.diagnostics.executions.snapshotEntries().find(entry => entry.name === 'map');
    expect(record).toBeUndefined();
    expect(internalRuntime.diagnostics.inspect(internalRuntime).executions.completed).toBeGreaterThan(0);
  });

  it('shows an active labeled operator execution while a pull is pending', async () => {
    let release!: (result: IteratorResult<number>) => void;
    const pendingSource = new Promise<IteratorResult<number>>(resolve => { release = resolve; });
    const source: AsyncIterator<number> = { next: () => pendingSource };
    const operator = map((value: number) => value);
    const iterator = operator.apply(source);

    const pull = iterator.next();
    await Promise.resolve();
    const record = internalRuntime.diagnostics.executions.snapshotEntries().find(entry => entry.name === 'map');
    expect(record).toBeDefined();
    expect(record!.active).toBe(true);

    release({ done: false, value: 7 });
    expect((await pull).value).toBe(7);
    await iterator.return?.();
    expect(internalRuntime.diagnostics.executions.snapshotEntries().find(entry => entry.name === 'map')).toBeUndefined();
  });

  it('tracks a flow execution from active through completion', async () => {
    let release!: (value: number) => void;
    const source = flow<number>(async function* () {
      yield 1;
      yield await new Promise<number>(resolve => { release = resolve; });
    });
    const seen: number[] = [];
    const sub = source.subscribe(value => seen.push(value));
    for (let i = 0; i < 10 && seen.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 0));

    expect(internalRuntime.diagnostics.executions.describe(source))
      .toEqual(jasmine.objectContaining({ active: true, runs: 1, emitted: 1 }));

    // Resolving the pending yield ends the generator, completing the flow.
    release(2);
    for (let i = 0; i < 10 && !source.disposed; i++) await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen).toEqual([1, 2]);
    expect(source.disposed).toBe(true);

    // The record is released together with the atom; global accounting remains.
    expect(internalRuntime.diagnostics.executions.describe(source)).toBeUndefined();
    expect(internalRuntime.diagnostics.inspect(internalRuntime).executions.completed).toBeGreaterThan(0);
    await sub();
  });

  it('captures the last error on a recoverable failed flow', async () => {
    const source = flow<number>(async function* () {
      yield 1;
      throw new Error('flow blew up');
    });
    const errors: unknown[] = [];
    const sub = source.subscribe(() => {});
    source.onError(error => errors.push(error));
    for (let i = 0; i < 10 && errors.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    // The atom survives a recoverable failure, and so does its record.
    expect(source.disposed).toBe(false);
    expect(internalRuntime.diagnostics.executions.describe(source)).toEqual(jasmine.objectContaining({
      active: false, runs: 1, emitted: 1, lastExit: 'error', lastError: new Error('flow blew up'),
    }));

    await sub();
    expect(internalRuntime.diagnostics.executions.describe(source)).toBeUndefined();
  });

  it('reads scheduler pending work through the default scheduler', () => {
    const scheduler = getScheduler();
    expect(scheduler.pending).toBe(0);
    expect(internalRuntime.diagnostics.inspect(internalRuntime).scheduler.paused).toBe(false);
  });
});


describe('automatic flow discovery', () => {
  it('discovers idle flows without starting them and reports pending pulls until disposal', async () => {
    let pulls = 0;
    let release!: (result: IteratorResult<number>) => void;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            pulls++;
            return new Promise<IteratorResult<number>>(resolve => { release = resolve; });
          },
          return: async () => ({ done: true as const, value: undefined }),
        };
      },
    };
    const node = flow(source);
    const inspect = () => internalRuntime.diagnostics.flows(internalRuntime.graph).find(state => state.node === node);
    expect(inspect()).toEqual(jasmine.objectContaining({
      started: false, awaitingNext: false, subscribers: 0, hasValue: false,
    }));
    expect(pulls).toBe(0);
    const seen: number[] = [];
    const stop = node.subscribe(value => seen.push(value));
    try {
      for (let i = 0; i < 20 && pulls === 0; i++) await new Promise(resolve => setTimeout(resolve, 0));
      expect(inspect()).toEqual(jasmine.objectContaining({ started: true, awaitingNext: true, subscribers: 1 }));
      release({ done: false, value: 7 });
      for (let i = 0; i < 20 && seen.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 0));
      expect(seen).toEqual([7]);
      expect(inspect()).toEqual(jasmine.objectContaining({ hasValue: true, value: 7 }));
    } finally {
      await stop();
    }
    expect(inspect()).toBeUndefined();
  });
});

describe('runtime self-description', () => {
  it('captures the creation site of atoms without build tooling', () => {
    const first = atom(1);
    const second = atom(2);
    const origin = internalRuntime.diagnostics.originOf(first);
    expect(origin).toBeDefined();
    expect(origin!.file.length).toBeGreaterThan(0);
    expect(origin!.line).toBeGreaterThan(0);
    // Distinct creation sites produce distinct origins.
    expect([origin!.line, origin!.column]).not.toEqual(
      [internalRuntime.diagnostics.originOf(second)!.line, internalRuntime.diagnostics.originOf(second)!.column]);
    // inspect() rows carry the origin too.
    const row = internalRuntime.diagnostics.inspect(internalRuntime).nodes.find(node => node.node === first);
    expect(row?.origin).toBeDefined();
  });

  it('labels operator executions with their pipeline creation site', async () => {
    const operator = map((value: number) => value);
    const source: AsyncIterator<number> = { next: async () => ({ done: false, value: 1 }) };
    const iterator = operator.apply(source);
    try {
      const pull = iterator.next();
      await tick();
      const record = internalRuntime.diagnostics.executions.snapshotEntries().find(entry => entry.name === 'map');
      expect(record?.origin).toBeDefined();
      expect(record!.origin!.line).toBeGreaterThan(0);
      await pull;
    } finally {
      await iterator.return?.();
    }
  });

  it('threads origins through flow execution records', async () => {
    let release!: (value: IteratorResult<number>) => void;
    // Stay mid-flight so the record and flow entry remain observable.
    const source = flow<number>(async function* () {
      yield 1;
      yield await new Promise<number>(resolve => { release = value => resolve(value.value!); });
    });
    const seen: number[] = [];
    const stop = source.subscribe(value => seen.push(value));
    try {
      for (let i = 0; i < 20 && seen.length === 0; i++) await tick();
      expect(internalRuntime.diagnostics.executions.describe(source)?.origin).toBeDefined();
      expect(internalRuntime.diagnostics.flows(internalRuntime.graph).find(state => state.node === source)?.origin).toBeDefined();
    } finally {
      release({ value: 2, done: false });
      for (let i = 0; i < 20 && !source.disposed; i++) await tick();
      await stop();
    }
  });

  it('capture can be disabled for production parity', () => {
    setOriginCapture(false);
    try {
      const source = atom(1);
      expect(internalRuntime.diagnostics.originOf(source)).toBeUndefined();
      const row = internalRuntime.diagnostics.inspect(internalRuntime).nodes.find(node => node.node === source);
      expect(row?.origin).toBeUndefined();
    } finally {
      setOriginCapture(true);
    }
  });
});
