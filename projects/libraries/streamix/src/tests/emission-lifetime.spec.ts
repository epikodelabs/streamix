import { fork } from '../lib/operators/fork';
import { expand } from '../lib/operators/expand';
import { atom } from '../lib/atoms/atom';
import { pipe } from '../lib/atoms/pipe';
import { from } from '../lib/factories';
import { concatMap } from '../lib/operators/concatMap';
import { exhaustMap } from '../lib/operators/exhaustMap';
import { mergeMap } from '../lib/operators/mergeMap';
import { switchMap } from '../lib/operators/switchMap';
import { type Operator, DONE, NEXT } from '../lib/atoms/operator';
import { __streamixDebug, __streamixDebugDispose, __streamixBeginLifetime, enableStreamixIntrospection, streamixInspector } from '../lib/runtime/introspection';

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const collect = async (iterator: AsyncIterator<number>) => {
  const values: number[] = [];
  for await (const value of { [Symbol.asyncIterator]: () => iterator }) values.push(value);
  return values;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('flattening emission lifetimes', () => {
  let now: number;
  const operators: object[] = [];
  const instrument = (name: string, op: Operator<number, number>, line = 1, column = 1) => {
    operators.push(op);
    return __streamixDebug(op, { name, kind: 'operator', file: 'lifetime.ts', line, column });
  };
  const summaries = (name: string) => streamixInspector.trace().filter(event => event.name === name && event.lifetime).map(event => event.lifetime!);
  beforeAll(() => enableStreamixIntrospection());
  beforeEach(() => { now = 0; spyOn(performance, 'now').and.callFake(() => now); });
  afterEach(() => { for (const op of operators.splice(0)) __streamixDebugDispose(op); });

  for (const [name, factory] of [['concat', concatMap], ['exhaust', exhaustMap]] as const) {
    it(name + ' includes projection waiting and preserves a single terminal snapshot', async () => {
      const pending = deferred<number>();
      const op = instrument('lifetime-' + name, factory<number, number>(() => pending.promise));
      const iterator = op.apply(from([1])[Symbol.asyncIterator]());
      const reading = collect(iterator);
      await tick();
      now = 25; pending.resolve(7);
      expect(await reading).toEqual([7]);
      const rows = summaries('lifetime-' + name);
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual(jasmine.objectContaining({ emission: 1, durationMs: 25, firstOutputMs: 25, outputs: 1, outcome: 'complete' }));
      expect(Object.isFrozen(rows[0])).toBeTrue();
      now = 100; await iterator.return?.();
      expect(summaries('lifetime-' + name).length).toBe(1);
      expect(rows[0].durationMs).toBe(25);
    });

    it(name + ' ends a pending projection immediately on cancellation', async () => {
      const pending = deferred<number>();
      const op = instrument('cancel-' + name, factory<number, number>(() => pending.promise));
      const iterator = op.apply(from([1])[Symbol.asyncIterator]());
      const reading = iterator.next();
      await tick();
      now = 30; await iterator.return?.();
      expect(summaries('cancel-' + name)[0]).toEqual(jasmine.objectContaining({ durationMs: 30, outcome: 'cancel', outputs: 0 }));
      now = 90; pending.resolve(1); await reading;
      expect(summaries('cancel-' + name).length).toBe(1);
    });
  }

  it('switchMap cancels a pending projection at replacement and ignores its late failure', async () => {
    const first = deferred<number>(), second = deferred<number>();
    const buffer = [1];
    let done = false;
    const source = {
      __onPush: () => {},
      __tryNext: () => buffer.length ? NEXT(buffer.shift()!) : done ? DONE : null,
      next: async () => DONE,
    };
    const op = instrument('lifetime-switch', switchMap<number, number>(value => value === 1 ? first.promise : second.promise));
    const iterator = op.apply(source);
    const reading = collect(iterator);
    now = 20; buffer.push(2); source.__onPush();
    expect(summaries('lifetime-switch')[0]).toEqual(jasmine.objectContaining({ emission: 1, durationMs: 20, outcome: 'cancel' }));
    now = 55; first.reject(new Error('obsolete')); second.resolve(2); done = true; source.__onPush();
    expect(await reading).toEqual([2]);
    const rows = summaries('lifetime-switch');
    expect(rows.length).toBe(2);
    expect(rows[1]).toEqual(jasmine.objectContaining({ emission: 2, durationMs: 35, outputs: 1, outcome: 'complete' }));
  });

  it('mergeMap includes internal queue time and records overflow as dropped', async () => {
    const pending = deferred<number>();
    const op = instrument('lifetime-merge', mergeMap<number, number>(value => value === 1 ? pending.promise : [value], 1, 1));
    const reading = collect(op.apply(from([1, 2, 3])[Symbol.asyncIterator]()));
    await tick();
    expect(summaries('lifetime-merge')[0]).toEqual(jasmine.objectContaining({ emission: 2, outcome: 'dropped', outputs: 0 }));
    now = 50; pending.resolve(1);
    expect(await reading).toEqual([1, 3]);
    const rows = summaries('lifetime-merge');
    expect(rows.length).toBe(3);
    expect(rows.find(row => row.emission === 1)).toEqual(jasmine.objectContaining({ durationMs: 50, queueMs: 0, outcome: 'complete' }));
    expect(rows.find(row => row.emission === 3)).toEqual(jasmine.objectContaining({ durationMs: 50, queueMs: 50, outcome: 'complete' }));
  });

  it('mergeMap records overlapping inner lifetimes independently', async () => {
    const first = deferred<number>(), second = deferred<number>();
    const op = instrument('parallel-merge', mergeMap<number, number>(value => value === 1 ? first.promise : second.promise));
    const reading = collect(op.apply(from([1, 2])[Symbol.asyncIterator]()));
    await tick(); now = 10; second.resolve(2); await tick();
    now = 40; first.resolve(1);
    expect(await reading).toEqual([2, 1]);
    const rows = summaries('parallel-merge');
    expect(rows.map(row => [row.emission, row.durationMs])).toEqual([[2, 10], [1, 40]]);
  });

  it('records projection errors without adding an inner completion', async () => {
    const op = instrument('error-lifetime', concatMap<number, number>(() => { now = 5; throw new Error('failed'); }));
    await expectAsync(collect(op.apply(from([1])[Symbol.asyncIterator]()))).toBeRejectedWithError('failed');
    expect(summaries('error-lifetime')).toEqual([jasmine.objectContaining({ durationMs: 5, outcome: 'error', outputs: 0 })]);
  });

  it('mergeMap cancels active and queued spans before iterator cleanup settles', async () => {
    const pending = deferred<number>();
    const op = instrument('cancel-merge', mergeMap<number, number>(() => pending.promise, 1));
    const iterator = op.apply(from([1, 2])[Symbol.asyncIterator]());
    const reading = iterator.next();
    await tick();
    now = 20;
    const closing = iterator.return?.();
    const rows = summaries('cancel-merge');
    expect(rows.length).toBe(2);
    expect(rows.every(row => row.durationMs === 20 && row.outcome === 'cancel')).toBeTrue();
    now = 80; pending.resolve(1);
    await closing; await reading;
    expect(summaries('cancel-merge').length).toBe(2);
  });

  it('exhaustMap reports buffered values as dropped without running projections', async () => {
    const pending = deferred<number>();
    const buffer = [1];
    let done = false, projected = 0;
    const source = {
      __tryNext: () => buffer.length ? NEXT(buffer.shift()!) : done ? DONE : null,
      next: async () => buffer.length ? NEXT(buffer.shift()!) : DONE,
    };
    const op = instrument('drop-exhaust', exhaustMap<number, number>(() => { projected++; return pending.promise; }));
    const iterator = op.apply(source);
    const first = iterator.next();
    await tick(); buffer.push(2, 3); done = true;
    now = 10; pending.resolve(7);
    expect(await first).toEqual(NEXT(7));
    expect(await iterator.next()).toEqual(DONE);
    expect(projected).toBe(1);
    expect(summaries('drop-exhaust').map(row => row.outcome)).toEqual(['complete', 'dropped', 'dropped']);
    expect(summaries('drop-exhaust')[0].durationMs).toBe(10);
  });

  for (const [name, factory] of [['concat', concatMap], ['exhaust', exhaustMap], ['switch', switchMap], ['merge', mergeMap]] as const) {
    it(name + ' ignores outer values that arrive after cancellation', async () => {
      const pending = deferred<IteratorResult<number>>();
      let projections = 0;
      const op = instrument('late-' + name, factory<number, number>(value => { projections++; return [value]; }));
      const iterator = op.apply({ next: () => pending.promise, return: async () => DONE });
      const reading = iterator.next();
      await tick();
      await iterator.return?.();
      pending.resolve(NEXT(9));
      await reading; await tick();
      expect(projections).toBe(0);
      expect(summaries('late-' + name)).toEqual([]);
    });
  }

  it('retains independent latest results for multiple flattening operators on one flow', async () => {
    const first = deferred<number>(), second = deferred<number>();
    const source = atom(1);
    const a = instrument('multi-switch', switchMap<number, number>(() => first.promise), 10);
    const b = instrument('multi-merge', mergeMap<number, number>(() => second.promise), 20);
    const flow = __streamixDebug(pipe(source, a, b), { name: 'multi-flow', kind: 'flow', file: 'lifetime.ts', line: 5, column: 1 });
    const id = streamixInspector.inspect({ name: 'multi-flow' })[0].id;
    const stop = flow.subscribe();
    try {
      await tick(); now = 10; first.resolve(1); await tick();
      now = 30; second.resolve(2); await tick();
      const snapshot = streamixInspector.details(id)!.innerLifetimes;
      expect(snapshot.map(row => [row.operator.name, row.operator.line, row.lifetime.durationMs])).toEqual([
        ['switchMap', 10, 10], ['mergeMap', 20, 20],
      ]);
      expect(Object.isFrozen(snapshot)).toBeTrue();
      expect(snapshot.every(row => Object.isFrozen(row) && Object.isFrozen(row.operator))).toBeTrue();
      const next = __streamixBeginLifetime(a)!;
      now = 40; next.start(); now = 50; next.finish('cancel');
      const updated = streamixInspector.details(id)!.innerLifetimes;
      expect(updated.length).toBe(2);
      expect(updated[0].lifetime.outcome).toBe('cancel');
      expect(updated[1]).toBe(snapshot[1]);
      expect(snapshot[0].lifetime.outcome).toBe('complete');
      const events = streamixInspector.trace().filter(event => event.kind === 'lifetime' && event.ownerName === 'multi-flow');
      expect(events.some(event => event.operator?.name === 'switchMap' && event.operator.line === 10)).toBeTrue();
      expect(events.some(event => event.operator?.name === 'mergeMap' && event.operator.line === 20)).toBeTrue();
    } finally { await stop(); flow.dispose(); source.dispose(); }
  });

  it('distinguishes two operators of the same type and keeps source order when they finish out of order', () => {
    const a = instrument('repeat-a', mergeMap<number, number>(value => [value]), 10, 2);
    const b = instrument('repeat-b', mergeMap<number, number>(value => [value]), 10, 25);
    const flow = __streamixDebug(pipe([1], a, b), { name: 'repeat-flow', kind: 'flow', file: 'lifetime.ts', line: 5, column: 1 });
    const id = streamixInspector.inspect({ name: 'repeat-flow' })[0].id;
    try {
      const first = __streamixBeginLifetime(a)!, second = __streamixBeginLifetime(b)!;
      second.finish('complete'); first.finish('error');
      const rows = streamixInspector.details(id)!.innerLifetimes;
      expect(rows.map(row => [row.operator.name, row.operator.column])).toEqual([['mergeMap', 2], ['mergeMap', 25]]);
      expect(rows[0].operator.id).not.toBe(rows[1].operator.id);
    } finally { flow.dispose(); }
  });

  const otherFlatteners: readonly [string, (project: (value: number) => any) => Operator<number, number>][] = [
    ['fork', project => fork<number, number>({ on: () => true, handler: project })],
    ['expand', project => expand<number>(project, { maxDepth: 1 })],
  ];
  for (const [name, factory] of otherFlatteners) {
    it(name + ' measures a projected inner without changing output semantics', async () => {
      const pending = deferred<number>();
      const op = instrument('other-' + name, factory(() => pending.promise));
      const reading = collect(op.apply(from([1])[Symbol.asyncIterator]()));
      await tick(); now = 25; pending.resolve(7);
      expect(await reading).toEqual(name === 'expand' ? [1, 7] : [7]);
      expect(summaries('other-' + name)).toEqual([jasmine.objectContaining({ durationMs: 25, firstOutputMs: 25, outputs: 1, outcome: 'complete' })]);
    });

    it(name + ' cancels pending projection work and ignores its late resolution', async () => {
      const pending = deferred<number>();
      const op = instrument('pending-other-' + name, factory(() => pending.promise));
      const iterator = op.apply(from([1])[Symbol.asyncIterator]());
      const reading = iterator.next();
      await tick(); now = 20; await iterator.return?.();
      expect(summaries('pending-other-' + name)).toEqual([jasmine.objectContaining({ durationMs: 20, outcome: 'cancel', outputs: 0 })]);
      now = 50; pending.resolve(9);
      expect(await reading).toEqual(DONE);
      expect(await iterator.next()).toEqual(DONE);
      expect(summaries('pending-other-' + name).length).toBe(1);
    });

    it(name + ' closes the active inner once and suppresses a late inner value', async () => {
      const pending = deferred<IteratorResult<number>>();
      let returned = 0;
      const op = instrument('active-other-' + name, factory(() => ({
        [Symbol.asyncIterator]: () => ({ next: () => pending.promise, return: async () => { returned++; return DONE; } }),
      })));
      const iterator = op.apply(from([1])[Symbol.asyncIterator]());
      const reading = iterator.next();
      await tick(); now = 30; await iterator.return?.();
      expect(returned).toBe(1);
      expect(summaries('active-other-' + name)[0].durationMs).toBe(30);
      pending.resolve(NEXT(99));
      expect(await reading).toEqual(DONE);
      await iterator.return?.();
      expect(returned).toBe(1);
      expect(summaries('active-other-' + name).length).toBe(1);
    });

    it(name + ' ignores an outer value received after cancellation', async () => {
      const pending = deferred<IteratorResult<number>>();
      let projected = 0;
      const op = instrument('outer-other-' + name, factory(value => { projected++; return [value]; }));
      const iterator = op.apply({ next: () => pending.promise, return: async () => DONE });
      const reading = iterator.next();
      await tick(); await iterator.return?.(); pending.resolve(NEXT(1));
      expect(await reading).toEqual(DONE);
      expect(projected).toBe(0);
      expect(summaries('outer-other-' + name)).toEqual([]);
    });
  }

  it('fork includes predicate waiting and skips the handler when cancelled during the predicate', async () => {
    const predicate = deferred<boolean>();
    let handled = 0;
    const op = instrument('fork-predicate', fork<number, number>({ on: () => predicate.promise, handler: value => { handled++; return value; } }));
    const iterator = op.apply(from([1])[Symbol.asyncIterator]());
    const reading = iterator.next();
    await tick(); now = 12; await iterator.return?.();
    predicate.resolve(true);
    expect(await reading).toEqual(DONE);
    expect(handled).toBe(0);
    expect(summaries('fork-predicate')).toEqual([jasmine.objectContaining({ durationMs: 12, outcome: 'cancel' })]);
  });

  const allFlatteners: readonly [string, (project: (value: number) => any) => Operator<number, number>][] = [
    ['concatMap', project => concatMap<number, number>(project)],
    ['exhaustMap', project => exhaustMap<number, number>(project)],
    ['mergeMap', project => mergeMap<number, number>(project)],
    ['switchMap', project => switchMap<number, number>(project)],
    ...otherFlatteners,
  ];
  for (const [name, factory] of allFlatteners) {
    it(name + ' reports an inner rejection as error exactly once', async () => {
      const pending = deferred<IteratorResult<number>>();
      let returned = 0;
      const op = instrument('rejection-' + name, factory(() => ({
        [Symbol.asyncIterator]: () => ({ next: () => pending.promise, return: async () => { returned++; return DONE; } }),
      })));
      const iterator = op.apply(from([1])[Symbol.asyncIterator]());
      const reading = iterator.next();
      const rejected = expectAsync(reading).toBeRejectedWithError('inner failed');
      await tick(); now = 17; pending.reject(new Error('inner failed'));
      await rejected;
      await iterator.return?.();
      expect(summaries('rejection-' + name)).toEqual([jasmine.objectContaining({ durationMs: 17, outcome: 'error' })]);
      expect(returned).toBe(1);
    });
  }

  it('does not create a span for an uninstrumented operator', () => {
    expect(__streamixBeginLifetime({})).toBeUndefined();
  });
});
