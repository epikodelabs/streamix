import { atom, from, iterate, pipe, takeUntil, timer } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('takeUntil', () => {
  it('takes source values until the notifier emits', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, takeUntil(notifier)))) {
        values.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    notifier.next();
    source.next(3);

    await reader;
    expect(values).toEqual([1, 2]);
  });

  it('emits all values when the source completes first', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([1, 2, 3]), takeUntil(timer(100))))) {
      values.push(value);
    }

    expect(values).toEqual([1, 2, 3]);
  });

  it('emits no source values when the notifier emits first', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, takeUntil(notifier)))) {
        values.push(value);
      }
    })();

    notifier.next();
    source.next(1);

    await reader;
    expect(values).toEqual([]);
  });

  it('propagates notifier errors after already emitted source values', async () => {
    const source = atom<number>();
    const notifier = atom<void>();
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(pipe(source, takeUntil(notifier)))) {
        values.push(value);
      }
    })();

    source.next(1);
    await wait(0);
    notifier.fail(new Error('Notifier failure'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'Notifier failure' }));
    expect(values).toEqual([1]);
  });

  it('supports direct async iterator completion when the notifier emits', async () => {
    const notifier = atom<void>();
    const source = {
      calls: 0,
      async next() {
        this.calls++;
        if (this.calls === 1) {
          return { value: 1, done: false as const };
        }

        return new Promise<IteratorResult<number>>(() => {});
      },
      async return() {
        return { value: undefined, done: true as const };
      }
    } as AsyncIterator<number> & { calls: number };
    const iterator = takeUntil(notifier).apply(source);

    expect(await iterator.next()).toEqual({ value: 1, done: false });

    notifier.next();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('propagates source errors through direct iterator.next()', async () => {
    const notifier = atom<void>();
    const source = {
      async next() {
        throw new Error('source failure');
      },
      async return() {
        return { value: undefined, done: true as const };
      }
    } as AsyncIterator<number>;
    const iterator = takeUntil(notifier).apply(source);

    await expectAsync(iterator.next()).toBeRejectedWithError('source failure');
  });

  it('supports synchronous draining and teardown helpers', async () => {
    const iterator = takeUntil(timer(100)).apply(iterate(from([1, 2]))[Symbol.asyncIterator]()) as AsyncIterator<number> & {
      __tryNext?: () => IteratorResult<number> | null;
      __hasBufferedValues?: () => boolean;
    };

    await wait(0);
    expect(iterator.__tryNext?.()).toEqual({ value: 1, done: false });
    expect(iterator.__tryNext?.()).toEqual({ value: 2, done: false });
    expect(iterator.__tryNext?.()).toEqual({ value: undefined, done: true });
    expect(iterator.__tryNext?.()).toEqual({ value: undefined, done: true });
    expect(iterator.__hasBufferedValues?.()).toBeTrue();
    expect(await iterator.return?.('done')).toEqual({ value: 'done', done: true });
  });

  it('normalizes direct iterator.throw calls before completion and after completion', async () => {
    const openIterator = takeUntil(timer(100)).apply(iterate(from([1]))[Symbol.asyncIterator]());
    await expectAsync(openIterator.throw?.('stop')).toBeRejectedWithError('stop');

    const completedIterator = takeUntil(timer(100)).apply(iterate(from([1]))[Symbol.asyncIterator]()) as AsyncIterator<number> & {
      __tryNext?: () => IteratorResult<number> | null;
    };

    await wait(0);
    completedIterator.__tryNext?.();
    completedIterator.__tryNext?.();
    await expectAsync(completedIterator.throw?.('again')).toBeRejectedWithError('again');
  });

  it('supports direct return on open iterators with and without an explicit value', async () => {
    const openIterator = takeUntil(timer(100)).apply(iterate(atom<number>())[Symbol.asyncIterator]());
    expect(await openIterator.return?.()).toEqual({ value: undefined, done: true });

    const valuedIterator = takeUntil(timer(100)).apply(iterate(atom<number>())[Symbol.asyncIterator]());
    expect(await valuedIterator.return?.('closed')).toEqual({ value: 'closed', done: true });
  });

  it('returns null from __tryNext when only async sources are pending', () => {
    const source = atom<number>();
    const iterator = takeUntil(timer(100)).apply(iterate(source)[Symbol.asyncIterator]()) as AsyncIterator<number> & {
      __tryNext?: () => IteratorResult<number> | null;
    };

    expect(iterator.__tryNext?.()).toBeNull();
  });

  it('closes synchronously when the notifier emits before buffered source values are consumed', async () => {
    const source = atom<number>();
    source.next(1);

    const iterator = takeUntil(from([true])).apply(iterate(source)[Symbol.asyncIterator]()) as AsyncIterator<number> & {
      __tryNext?: () => IteratorResult<number> | null;
    };

    await wait(0);
    expect(iterator.__tryNext?.()).toEqual({ value: undefined, done: true });
  });

  it('propagates synchronous source errors through __tryNext()', async () => {
    const source = {
      async next() {
        return new Promise<IteratorResult<number>>(() => {});
      },
      __tryNext() {
        throw new Error('sync source failure');
      },
      async return() {
        return { value: undefined, done: true as const };
      }
    } as AsyncIterator<number> & { __tryNext: () => IteratorResult<number> | null };

    const iterator = takeUntil(timer(100)).apply(source) as AsyncIterator<number> & {
      __tryNext?: () => IteratorResult<number> | null;
    };

    await expectAsync(Promise.resolve().then(() => iterator.__tryNext?.())).toBeRejectedWithError('sync source failure');
  });
});
