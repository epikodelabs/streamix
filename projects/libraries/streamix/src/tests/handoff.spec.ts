import { atom, from, handoff, iterate, pipe } from '@epikodelabs/streamix';
import { collect, sleep as wait } from './helpers/operator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function controlledSource<T>() {
  let resolveNext!: (result: IteratorResult<T>) => void;
  const source: AsyncIterator<T> = {
    next: () => new Promise(resolve => { resolveNext = resolve; }),
    return: async () => ({ done: true, value: undefined }),
  };
  return { source, emit: (value: T) => resolveNext({ done: false, value }) };
}

describe('handoff', () => {
  it('emits each ready resource and disposes the previous one after its successor is ready', async () => {
    const source = atom<number>();
    const events: string[] = [];
    const output = pipe(source, handoff<number, string>({
      prepare: value => { events.push(`prepare ${value}`); return `r${value}`; },
      ready: resource => { events.push(`ready ${resource}`); },
      dispose: resource => { events.push(`dispose ${resource}`); },
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await wait(10);
    source.set(2);
    await wait(10);
    source.dispose();

    expect(await reader).toEqual(['r1', 'r2']);
    expect(events).toEqual([
      'prepare 1', 'ready r1',
      'prepare 2', 'ready r2', 'dispose r1',
      'dispose r2',
    ]);
  });

  it('keeps the active resource available until its successor is ready', async () => {
    const source = atom<number>();
    const secondReady = deferred<void>();
    const disposed: string[] = [];
    const output = pipe(source, handoff<number, string>({
      prepare: value => `r${value}`,
      ready: resource => resource === 'r2' ? secondReady.promise : undefined,
      dispose: resource => { disposed.push(resource); },
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await wait(10);
    source.set(2);
    await wait(10);
    expect(disposed).toEqual([]);

    secondReady.resolve();
    await wait(10);
    expect(disposed).toEqual(['r1']);

    source.dispose();
    expect(await reader).toEqual(['r1', 'r2']);
    expect(disposed).toEqual(['r1', 'r2']);
  });

  it('aborts and disposes a provisional resource superseded before it is ready', async () => {
    const source = atom<number>();
    const firstReady = deferred<void>();
    const signals: AbortSignal[] = [];
    const disposed: string[] = [];
    const output = pipe(source, handoff<number, string>({
      prepare: (value, signal) => { signals.push(signal); return `r${value}`; },
      ready: (resource, signal) => {
        signals.push(signal);
        return resource === 'r1' ? firstReady.promise : undefined;
      },
      dispose: resource => { disposed.push(resource); },
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await wait(10);
    source.set(2);
    await wait(10);
    expect(signals[0].aborted).toBeTrue();

    firstReady.resolve();
    await wait(10);
    source.dispose();

    expect(await reader).toEqual(['r2']);
    expect(disposed).toEqual(['r1', 'r2']);
  });

  it('fails the output when the latest preparation fails', async () => {
    const source = atom<number>();
    const output = pipe(source, handoff<number, string>({
      prepare: () => { throw new Error('prepare boom'); },
      ready: () => undefined,
      dispose: () => {},
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await expectAsync(reader).toBeRejectedWithError('prepare boom');
    source.dispose();
  });

  it('ignores a preparation failure from a superseded value', async () => {
    const source = atom<number>();
    const first = deferred<string>();
    const output = pipe(source, handoff<number, string>({
      prepare: value => value === 1 ? first.promise : `r${value}`,
      ready: () => undefined,
      dispose: () => {},
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await wait(10);
    source.set(2);
    await wait(10);
    first.reject(new Error('stale'));
    await wait(10);
    source.dispose();

    expect(await reader).toEqual(['r2']);
  });

  it('disposes a resource that fails readiness and fails the output', async () => {
    const source = atom<number>();
    const disposed: string[] = [];
    const output = pipe(source, handoff<number, string>({
      prepare: value => `r${value}`,
      ready: () => { throw new Error('not ready'); },
      dispose: resource => { disposed.push(resource); },
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await expectAsync(reader).toBeRejectedWithError('not ready');
    expect(disposed).toEqual(['r1']);
    source.dispose();
  });

  it('completes on source end without waiting for an unfinished replacement', async () => {
    const finalReady = deferred<void>();
    const disposed: string[] = [];
    let completed = false;
    const output = pipe(from([1]), handoff<number, string>({
      prepare: value => `r${value}`,
      ready: () => finalReady.promise,
      dispose: resource => { disposed.push(resource); },
    }));
    const reader = collect(iterate(output)).then(values => {
      completed = true;
      return values;
    });

    // The source ends while `ready` is still pending. Completion must not wait
    // for a user promise that may never settle.
    await wait(20);
    expect(completed).toBeTrue();
    expect(await reader).toEqual([]);

    finalReady.resolve();
    await wait(5);
    expect(disposed).toEqual(['r1']);
  });

  it('completes despite a latest preparation that ignores abort and never settles', async () => {
    const source = atom<number>();
    const never = deferred<string>();
    const disposed: string[] = [];
    const output = pipe(source, handoff<number, string>({
      prepare: () => never.promise,
      ready: () => undefined,
      dispose: resource => { disposed.push(resource); },
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await wait(5);
    source.dispose();

    expect(await reader).toEqual([]);

    never.resolve('r1');
    await wait(5);
    expect(disposed).toEqual(['r1']);
  });

  it('does not let a superseded preparation that never settles block completion', async () => {
    const source = atom<number>();
    const stale = deferred<string>();
    const output = pipe(source, handoff<number, string>({
      // Ignores the abort signal and never resolves.
      prepare: value => value === 1 ? stale.promise : `r${value}`,
      ready: () => undefined,
      dispose: () => {},
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await wait(5);
    source.set(2);
    await wait(5);
    source.dispose();

    expect(await reader).toEqual(['r2']);
  });

  it('disposes a superseded preparation that resolves after completion', async () => {
    const source = atom<number>();
    const stale = deferred<string>();
    const disposed: string[] = [];
    const output = pipe(source, handoff<number, string>({
      prepare: value => value === 1 ? stale.promise : `r${value}`,
      ready: () => undefined,
      dispose: resource => { disposed.push(resource); },
    }));
    const reader = collect(iterate(output));

    source.set(1);
    await wait(5);
    source.set(2);
    await wait(5);
    source.dispose();
    expect(await reader).toEqual(['r2']);
    await wait(5);
    expect(disposed).toEqual(['r2']);

    // The stale work finishes only after the output completed: it must be
    // released without being emitted or resurrecting the operator.
    stale.resolve('r1');
    await wait(5);
    expect(disposed).toEqual(['r2', 'r1']);
  });

  it('aborts and disposes the active resource when the operator iterator returns', async () => {
    const { source, emit } = controlledSource<number>();
    const signals: AbortSignal[] = [];
    const disposed: string[] = [];
    const iterator = handoff<number, string>({
      prepare: (value, signal) => { signals.push(signal); return `r${value}`; },
      ready: () => undefined,
      dispose: resource => { disposed.push(resource); },
    }).apply(source);

    emit(1);
    expect(await iterator.next()).toEqual({ value: 'r1', done: false });

    await iterator.return?.();
    expect(signals[0].aborted).toBeTrue();
    expect(disposed).toEqual(['r1']);
  });

  it('fails and disposes the active resource when the operator iterator throws', async () => {
    const { source, emit } = controlledSource<number>();
    const disposed: string[] = [];
    const iterator = handoff<number, string>({
      prepare: value => `r${value}`,
      ready: () => undefined,
      dispose: resource => { disposed.push(resource); },
    }).apply(source);

    emit(1);
    expect(await iterator.next()).toEqual({ value: 'r1', done: false });

    await expectAsync(iterator.throw!(new Error('boom'))).toBeRejectedWithError('boom');
    expect(disposed).toEqual(['r1']);
  });

  it('fails the output when the source fails', async () => {
    const iterator = handoff<number, string>({
      prepare: value => `r${value}`,
      ready: () => undefined,
      dispose: () => {},
    }).apply({
      next: () => Promise.reject(new Error('source boom')),
    });

    await expectAsync(iterator.next()).toBeRejectedWithError('source boom');
  });
});
