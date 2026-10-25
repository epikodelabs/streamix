import { trackOperatorExecution } from '@epikodelabs/streamix/introspection';
import { pipe } from '../lib/atoms/pipe';
import { concatMap } from '../lib/operators/concatMap';
import { atom } from '../lib/atoms/atom';
import { internalRuntime } from '../lib/runtime/runtime';
import { __streamixDebug, __streamixDebugDispose, enableStreamixIntrospection, streamixInspector } from '@epikodelabs/streamix/introspection';

describe('inspector emission metrics', () => {
  beforeAll(() => enableStreamixIntrospection());
  const metadata = (name: string, kind: 'source' | 'atom' = 'source') => ({ name, kind, file: 'metrics.ts', line: 1, column: 1 });

  it('captures a separate immutable counter on every emission, independently per source', () => {
    const a = __streamixDebug({}, metadata('metrics-a'));
    const b = __streamixDebug({}, metadata('metrics-b'));
    const id = streamixInspector.inspect({ name: 'metrics-a' })[0].id;
    const emit = (node: object) => internalRuntime.events.publish({ node, generation: 1, kind: 'next', value: 'value' });
    try {
      expect(streamixInspector.details(id)!.metrics.total).toBe(0);
      emit(a); emit(b);
      const first = streamixInspector.trace().find(event => event.id === id && event.kind === 'next')!;
      expect(first.emission).toBe(1);
      emit(a);
      const snapshot = streamixInspector.details(id)!.metrics;
      expect(snapshot.total).toBe(2);
      expect(Object.isFrozen(snapshot)).toBeTrue();
      expect(first.emission).toBe(1);
      expect(streamixInspector.trace().filter(event => event.id === id && event.kind === 'next').map(event => event.emission)).toEqual([1, 2]);
      expect(streamixInspector.inspect({ name: 'metrics-b' })[0].metrics.total).toBe(1);
      internalRuntime.events.publish({ node: a, generation: 1, kind: 'error', error: 'failed' });
      internalRuntime.events.publish({ node: a, generation: 2, kind: 'cancel' });
      internalRuntime.events.publish({ node: a, generation: 3, kind: 'complete' });
      expect(streamixInspector.details(id)!.metrics).toEqual({ total: 2, errors: 1, cancelled: 1, completed: 1 });
      __streamixDebug(a, metadata('metrics-renamed'));
      emit(a);
      expect(streamixInspector.details(id)!.metrics.total).toBe(3);
      expect(snapshot.total).toBe(2);
      expect(streamixInspector.trace().at(-1)!.emission).toBe(3);
    } finally { __streamixDebugDispose(a); __streamixDebugDispose(b); }
  });

  it('captures independent pull durations for overlapping requests', async () => {
    let now = 0;
    spyOn(performance, 'now').and.callFake(() => now);
    const pending: ((value: IteratorResult<number>) => void)[] = [];
    const iterator = trackOperatorExecution({ next: () => new Promise<IteratorResult<number>>(resolve => pending.push(resolve)) });
    __streamixDebug(iterator, metadata('timed-pulls'));
    try {
      const first = iterator.next();
      now = 5; const second = iterator.next();
      now = 10; pending[1]({ done: false, value: 2 }); await second;
      const printed = streamixInspector.trace().filter(event => event.name === 'timed-pulls' && event.kind === 'next')[0];
      expect(printed.pullMs).toBe(5);
      now = 20; pending[0]({ done: false, value: 1 }); await first;
      expect(streamixInspector.trace().filter(event => event.name === 'timed-pulls' && event.kind === 'next').map(event => event.pullMs)).toEqual([5, 20]);
      expect(printed.pullMs).toBe(5);
    } finally { __streamixDebugDispose(iterator); }
  });

  it('times flow source pulls and exposes the last finished inner lifetime on its owning flow', async () => {
    let now = 0;
    spyOn(performance, 'now').and.callFake(() => now);
    let release!: (value: number) => void;
    const source = atom(1);
    const op = __streamixDebug(concatMap<number, number>(() => new Promise<number>(resolve => { release = resolve; })),
      { ...metadata('timed-inner'), kind: 'operator' });
    const node = __streamixDebug(pipe(source, op), { ...metadata('timed-flow'), kind: 'flow' });
    const id = streamixInspector.inspect({ name: 'timed-flow' })[0].id;
    const stop = node.subscribe();
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      now = 25; release(7);
      await new Promise(resolve => setTimeout(resolve, 0));
      const event = streamixInspector.trace().find(event => event.name === 'timed-flow' && event.kind === 'next')!;
      expect(event.pullMs).toBe(25);
      expect(streamixInspector.details(id)?.innerLifetimes[0]?.lifetime.durationMs).toBe(25);
      expect(streamixInspector.details(id)?.innerLifetimes[0]?.lifetime.outcome).toBe('complete');
    } finally { await stop(); node.dispose(); source.dispose(); __streamixDebugDispose(op); }
  });

  it('counts committed atom changes and retains totals after trace rollover', () => {
    const node = __streamixDebug(atom(0), metadata('metrics-atom', 'atom'));
    const id = streamixInspector.inspect({ name: 'metrics-atom' })[0].id;
    try {
      expect(streamixInspector.details(id)!.metrics.total).toBe(0);
      for (let i = 1; i <= 1100; i++) node.set(i);
      expect(streamixInspector.details(id)!.metrics.total).toBe(1100);
      expect(streamixInspector.details(id)!.emitted).toBe(1100);
      expect(streamixInspector.trace().length).toBe(1000);
    } finally { node.dispose(); }
  });
});
