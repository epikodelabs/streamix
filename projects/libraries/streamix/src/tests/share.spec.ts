import { atom, flow, iterate, pipe, share } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('share', () => {
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
    expect(second).toEqual([2, 3]);
  });

  it('does not replay values emitted before a later consumer subscribes', async () => {
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
    expect(second).toEqual([2, 3]);
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
