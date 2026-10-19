import { internalRuntime } from '../lib/runtime/runtime';
import { RuntimeExecutions, isRuntimeInstrumentationEnabled, setRuntimeInstrumentationEnabled } from '../lib/runtime/diagnostics';
import { RuntimeEventBus } from '../lib/runtime/events';
import { atom, flow } from '../lib/atoms/atom';

function tick(): Promise<void> { return new Promise(resolve => setTimeout(resolve, 0)); }

// Production parity: with instrumentation disabled, diagnostics bookkeeping
// must record nothing and allocate no per-node state readers.
describe('runtime instrumentation gating', () => {
  afterEach(() => { setRuntimeInstrumentationEnabled(true); });

  it('skips execution accounting while disabled and resumes when enabled', () => {
    const executions = new RuntimeExecutions();
    const node = {};
    setRuntimeInstrumentationEnabled(false);
    expect(isRuntimeInstrumentationEnabled()).toBe(false);

    const token = executions.start(node, 'flow');
    executions.next(node, token);
    executions.finish(node, token, 'complete');
    expect(executions.snapshot()).toEqual(jasmine.objectContaining({
      active: 0, started: 0, completed: 0, emitted: 0,
    }));
    expect(executions.describe(node)).toBeUndefined();
    expect(executions.snapshotEntries()).toEqual([]);

    setRuntimeInstrumentationEnabled(true);
    const fresh = executions.start(node, 'flow');
    executions.next(node, fresh);
    executions.finish(node, fresh, 'cancel');
    expect(executions.snapshot()).toEqual(jasmine.objectContaining({ started: 1, cancelled: 1, emitted: 1 }));
    expect(executions.describe(node)).toEqual(jasmine.objectContaining({ runs: 1, lastExit: 'cancel' }));
  });

  it('releases executions that were active when capture was disabled', () => {
    const executions = new RuntimeExecutions();
    const node = {};
    const token = executions.start(node, 'flow');
    expect(executions.snapshot().active).toBe(1);

    setRuntimeInstrumentationEnabled(false);
    executions.next(node, token);
    executions.finish(node, token, 'complete');
    expect(executions.snapshot().active).toBe(0);
    // Counters freeze at the moment capture stopped; the record stays readable.
    expect(executions.describe(node)).toEqual(jasmine.objectContaining({ active: false, runs: 1, emitted: 0 }));
  });

  it('drops events published while unobserved and delivers only observed ones', () => {
    const dispatcher = new RuntimeEventBus();
    dispatcher.publish({ node: {}, generation: 1, kind: 'next', value: 'unobserved' });

    const received: unknown[] = [];
    const stop = dispatcher.observe(event => received.push(event));
    dispatcher.publish({ node: {}, generation: 2, kind: 'next', value: 'observed' });
    stop();
    dispatcher.publish({ node: {}, generation: 3, kind: 'next', value: 'unobserved again' });

    expect(received.length).toBe(1);
    expect((received[0] as { value: unknown }).value).toBe('observed');
  });

  it('allocates no atom state reader while disabled', () => {
    setRuntimeInstrumentationEnabled(false);
    const quiet = atom(1);
    expect(internalRuntime.diagnostics.atomState(quiet)).toBeUndefined();

    setRuntimeInstrumentationEnabled(true);
    const loud = atom(2);
    expect(internalRuntime.diagnostics.atomState(loud)).toEqual(jasmine.objectContaining({ hasValue: true, value: 2, subscribers: 0 }));
  });

  it('leaves no flow entry or execution record while disabled', async () => {
    // Stay mid-flight so the flow remains registered and its record would be
    // observable; a completed flow disposes and forgets records on its own.
    const hold = (yielded: number) => {
      let release!: (value: number) => void;
      const source = flow<number>(async function* () {
        yield yielded;
        yield await new Promise<number>(resolve => { release = resolve; });
      });
      return { source, release: (value: number) => release(value) };
    };

    setRuntimeInstrumentationEnabled(false);
    const quiet = hold(1);
    const seen: number[] = [];
    const stop = quiet.source.subscribe(value => seen.push(value));
    try {
      for (let i = 0; i < 20 && seen.length === 0; i++) await tick();
      expect(seen).toEqual([1]);
      expect(internalRuntime.diagnostics.flows(internalRuntime.graph).find(state => state.node === quiet.source)).toBeUndefined();
      expect(internalRuntime.diagnostics.executions.describe(quiet.source)).toBeUndefined();
    } finally {
      quiet.release(0);
      for (let i = 0; i < 20 && !quiet.source.disposed; i++) await tick();
      await stop();
    }

    setRuntimeInstrumentationEnabled(true);
    const loud = hold(2);
    const loudSeen: number[] = [];
    const loudStop = loud.source.subscribe(value => loudSeen.push(value));
    try {
      for (let i = 0; i < 20 && loudSeen.length === 0; i++) await tick();
      expect(internalRuntime.diagnostics.executions.describe(loud.source)).toEqual(jasmine.objectContaining({ active: true }));
      expect(internalRuntime.diagnostics.flows(internalRuntime.graph).find(state => state.node === loud.source)).toBeDefined();
    } finally {
      loud.release(0);
      for (let i = 0; i < 20 && !loud.source.disposed; i++) await tick();
      await loudStop();
    }
  });
});
