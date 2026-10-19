import { RuntimeEventBus } from '../lib/runtime/events';
import { internalRuntime, StreamixRuntime } from '../lib/runtime/runtime';
import { flow } from '../lib/atoms/atom';

describe('internal runtime execution events', () => {
  it('isolates graph observer errors without losing invalidation or disposal', () => {
    const runtime = new StreamixRuntime();
    const source = {}, dependent = {};
    const invalidate = jasmine.createSpy('invalidate');
    const observed: string[] = [];
    runtime.events.observe(() => { throw new Error('diagnostic failure'); });
    runtime.events.observe(event => observed.push(event.kind));
    expect(() => {
      runtime.register(source);
      runtime.register(dependent);
      runtime.dependencies(dependent, [source]);
      runtime.onInvalidate(dependent, invalidate);
      runtime.changed(source);
      runtime.dispose(dependent);
    }).not.toThrow();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(observed).toEqual(['register', 'register', 'dependencies', 'change', 'dispose']);
    expect(runtime.graph.has(dependent)).toBe(false);
  });
  it('delivers reentrant events in FIFO order', () => {
    const events = new RuntimeEventBus();
    const node = {};
    const received: string[] = [];
    events.observe(event => {
      received.push(`first:${event.kind}`);
      if (event.kind === 'next') events.publish({ node, generation: 1, kind: 'complete' });
    });
    events.observe(event => received.push(`second:${event.kind}`));
    events.publish({ node, generation: 1, kind: 'next', value: 0 });
    expect(received).toEqual(['first:next', 'second:next', 'first:complete', 'second:complete']);
  });

  it('isolates observer failures and preserves sequence', () => {
    const events = new RuntimeEventBus();
    const node = {};
    const sequences: number[] = [];
    events.observe(() => { throw new Error('diagnostics failure'); });
    events.observe(event => sequences.push(event.sequence));
    events.publish({ node, generation: 1, kind: 'next', value: undefined });
    events.publish({ node, generation: 1, kind: 'cancel' });
    expect(sequences).toEqual([1, 2]);
  });

  it('reports flow values through the internal event dispatcher', async () => {
    const source = flow<number>(async function* () { yield 7; yield 8; });
    const received: number[] = [];
    const stop = internalRuntime.events.observe(event => {
      if (event.node === source && event.kind === 'next') received.push(event.value as number);
    });
    const sub = source.subscribe(() => {});
    try {
      for (let i = 0; i < 30 && received.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 0));
      expect(received).toEqual([7, 8]);
    } finally {
      stop();
      await sub();
      await source.dispose();
    }
  });
});
