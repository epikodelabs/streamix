import { atom, flow, iterate, pipe, share } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('share', () => {
  it('starts a fresh session after finite completion', async () => {
    const op = share<number>();
    const collect = async (value: number) => {
      let pulled = false;
      const reader = op.apply({ next: async () => pulled
        ? { value: undefined, done: true }
        : (pulled = true, { value, done: false }) });
      const values: number[] = [];
      while (true) {
        const item = await reader.next();
        if (item.done) break;
        values.push(item.value);
      }
      return values;
    };
    expect(await collect(1)).toEqual([1]);
    expect(await collect(2)).toEqual([2]);
  });

  it('isolates reconnects from cancelled pumps and repeated returns', async () => {
    const op = share<number>();
    const sources = [0, 1, 2].map(() => {
      let resolve!: (value: IteratorResult<number>) => void;
      let pulls = 0;
      let returns = 0;
      return {
        next: () => { pulls++; return new Promise<IteratorResult<number>>(r => resolve = r); },
        return: async () => { returns++; return { value: undefined, done: true as const }; },
        emit: (value: number) => resolve({ value, done: false }),
        get pulls() { return pulls; },
        get returns() { return returns; },
      };
    });
    const old = op.apply(sources[0]);
    await old.return?.();
    const current = op.apply(sources[1]);
    const other = op.apply(sources[2]);
    await old.return?.();
    sources[0].emit(99);
    const pending = current.next();
    sources[1].emit(7);
    expect(await pending).toEqual({ value: 7, done: false });
    expect(sources[0].pulls).toBe(1);
    expect(sources[0].returns).toBe(1);
    await current.return?.();
    await current.return?.();
    expect(sources[1].returns).toBe(0);
    const remaining = other.next();
    expect(await remaining).toEqual({ value: 7, done: false });
    const live = other.next();
    sources[1].emit(8);
    expect(await live).toEqual({ value: 8, done: false });
    await other.return?.();
    expect(sources[1].returns).toBe(1);
    sources[1].emit(9);
    await wait(0);
    expect(sources[1].pulls).toBe(3);
  });

  it('shares one source execution across overlapping consumers', async () => {
    let executions = 0;
    const source = flow<number>(async function* () {
      executions++;
      yield 1;
      await wait(10);
      yield 2;
      await wait(10);
      yield 3;
    });
    const shared = pipe(source, share());

    const first: number[] = [];
    const second: number[] = [];
    const firstRun = (async () => {
      for await (const value of iterate(shared)) first.push(value);
    })();

    await wait(5);

    const secondRun = (async () => {
      for await (const value of iterate(shared)) second.push(value);
    })();

    await Promise.all([firstRun, secondRun]);

    expect(executions).toBe(1);
    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([1, 2, 3]);
  });

  it('delivers the current shared value to a later consumer without replaying history', async () => {
    const source = atom<number>();
    const shared = pipe(source, share());

    const first: number[] = [];
    const second: number[] = [];
    const firstRun = (async () => {
      for await (const value of iterate(shared)) first.push(value);
    })();

    source.next(1);
    await wait(0);

    const secondRun = (async () => {
      for await (const value of iterate(shared)) second.push(value);
    })();

    source.next(2);
    source.next(3);
    source.dispose();

    await Promise.all([firstRun, secondRun]);

    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([1, 2, 3]);
  });

  it('propagates source errors to consumers', async () => {
    const source = atom<number>();
    const shared = pipe(source, share());
    const values: number[] = [];

    const reader = (async () => {
      for await (const value of iterate(shared)) values.push(value);
    })();

    source.next(1);
    source.fail(new Error('boom'));

    await expectAsync(reader).toBeRejectedWith(jasmine.objectContaining({ message: 'boom' }));
    expect(values).toEqual([1]);
  });

  it('handles iterator return', async () => {
    const source = atom<number>();
    const shared = pipe(source, share());
    const iterator = iterate(shared)[Symbol.asyncIterator]();

    source.next(1);
    expect(await iterator.next()).toEqual({ value: 1, done: false });

    expect(await iterator.return?.()).toEqual({ value: undefined, done: true });
  });

  it('closes unused upstream iterators when already connected', async () => {
    const sharedOperator = share<number>();
    let source1Calls = 0;
    const source1 = {
      async next() {
        source1Calls++;
        if (source1Calls === 1) {
          return { value: 1, done: false as const };
        }

        return new Promise<IteratorResult<number>>(() => {});
      },
      async return() {
        return { value: undefined, done: true as const };
      }
    } as AsyncIterator<number>;
    const source2Return = jasmine.createSpy('source2Return').and.returnValue(
      Promise.reject(new Error('ignored'))
    );
    const source2 = {
      async next() {
        return { value: 2, done: false as const };
      },
      return: source2Return,
    } as AsyncIterator<number>;

    const first = sharedOperator.apply(source1);
    const firstIterator = (first as AsyncIterableIterator<number>)[Symbol.asyncIterator]();
    expect(await firstIterator.next()).toEqual({ value: 1, done: false });

    const second = sharedOperator.apply(source2);
    const secondIterator = (second as AsyncIterableIterator<number>)[Symbol.asyncIterator]();
    await wait(0);

    expect(source2Return).toHaveBeenCalled();
    await secondIterator.return?.();
    await firstIterator.return?.();
  });

  it('allows already-connected subscriptions whose fresh upstream iterator has no return method', async () => {
    const sharedOperator = share<number>();
    let source1Calls = 0;
    const source1 = {
      async next() {
        source1Calls++;
        if (source1Calls === 1) {
          return { value: 1, done: false as const };
        }

        return new Promise<IteratorResult<number>>(() => {});
      },
      async return() {
        return { value: undefined, done: true as const };
      }
    } as AsyncIterator<number>;
    const source2 = {
      async next() {
        return { value: 2, done: false as const };
      }
    } as AsyncIterator<number>;

    const firstIterator = (sharedOperator.apply(source1) as AsyncIterableIterator<number>)[Symbol.asyncIterator]();
    expect(await firstIterator.next()).toEqual({ value: 1, done: false });

    const secondIterator = (sharedOperator.apply(source2) as AsyncIterableIterator<number>)[Symbol.asyncIterator]();
    await secondIterator.return?.();
    await firstIterator.return?.();
  });

  it('does not disconnect while another subscriber is still active and normalizes iterator.throw', async () => {
    const sharedOperator = share<number>();
    const sourceReturn = jasmine.createSpy('sourceReturn').and.returnValue(
      Promise.resolve({ value: undefined, done: true })
    );
    let sourceCalls = 0;
    const source = {
      async next() {
        sourceCalls++;
        if (sourceCalls === 1) {
          return { value: 1, done: false as const };
        }

        return new Promise<IteratorResult<number>>(() => {});
      },
      return: sourceReturn,
    } as AsyncIterator<number>;

    const first = sharedOperator.apply(source);
    const second = sharedOperator.apply({
      async next() {
        return new Promise<IteratorResult<number>>(() => {});
      },
      async return() {
        return { value: undefined, done: true as const };
      }
    });

    const firstIterator = (first as AsyncIterableIterator<number>)[Symbol.asyncIterator]();
    const secondIterator = (second as AsyncIterableIterator<number>)[Symbol.asyncIterator]();

    expect(await firstIterator.next()).toEqual({ value: 1, done: false });
    expect(await firstIterator.return?.()).toEqual({ value: undefined, done: true });
    expect(sourceReturn).not.toHaveBeenCalled();

    await expectAsync(secondIterator.throw?.('boom')).toBeRejectedWithError('boom');
    expect(sourceReturn).not.toHaveBeenCalled();
    await secondIterator.return?.();
  });
});
