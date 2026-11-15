import { DONE, NEXT, iterate, map, pipe, shareReplay } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const collect = async <T>(iterator: AsyncIterator<T>) => {
  const values: T[] = [];
  while (true) {
    const result = await iterator.next();
    if (result.done) break;
    values.push(result.value);
  }
  return values;
};

const emptySource = <T>(): AsyncIterator<T> => ({
  next: async () => DONE,
});

describe('shareReplay', () => {
  it('rejects invalid replay sizes at creation', () => {
    for (const size of [2.5, -1, NaN, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => shareReplay(size)).toThrowError(RangeError,
        'shareReplay bufferSize must be a non-negative safe integer or Infinity');
    }
  });

  it('retains the latest suffix across multiple buffer rotations', async () => {
    for (const size of [0, 1, 2, 3, Infinity]) {
      const op = shareReplay<number>(size);
      const values = Array.from({ length: 10 }, (_, i) => i + 1);
      async function* source() { yield* values; }
      expect(await collect(op.apply(source()))).toEqual(values);
      expect(await collect(op.apply(emptySource<number>())))
        .toEqual(size === 0 ? [] : values.slice(-size));
    }
  });

  it('preserves the completed bounded cache through public pipe iteration', async () => {
    const shared = pipe([1, 2, 3], shareReplay<number>(2));
    expect(await collect(iterate(shared))).toEqual([1, 2, 3]);
    expect(await collect(iterate(shared))).toEqual([2, 3]);
    expect(await collect(shared[Symbol.asyncIterator]())).toEqual([2, 3]);
  });

  it('applies downstream transformations to completed replay readers', async () => {
    const shared = pipe([1, 2, 3], shareReplay<number>(2), map(value => value * 10));
    expect(await collect(iterate(shared))).toEqual([10, 20, 30]);
    expect(await collect(iterate(shared))).toEqual([20, 30]);
  });

  it('reconnects after cancellation without accepting stale in-flight values', async () => {
    const op = shareReplay<number>(2);
    let resolveOld!: (value: IteratorResult<number>) => void;
    let pulls = 0;
    let returns = 0;
    const first = op.apply({
      next: async () => ++pulls === 1 ? NEXT(1)
        : new Promise<IteratorResult<number>>(resolve => resolveOld = resolve),
      return: async () => { returns++; return DONE; },
    });
    expect(await first.next()).toEqual(NEXT(1));
    await first.return?.();
    await first.return?.();
    expect(returns).toBe(1);
    let next = 1;
    const second = op.apply({ next: async () => ++next <= 3 ? NEXT(next) : DONE });
    resolveOld(NEXT(99));
    expect(await collect(second)).toEqual([1, 2, 3]);
    expect(pulls).toBe(2);
    expect(await collect(op.apply(emptySource()))).toEqual([2, 3]);
  });

  it('replays emitted values to later consumers without rerunning the first source', async () => {
    const op = shareReplay<number>();
    let pulls = 0;
    const source: AsyncIterator<number> = {
      next: async () => {
        pulls++;
        if (pulls <= 3) return NEXT(pulls);
        return DONE;
      },
    };

    expect(await collect(op.apply(source as any))).toEqual([1, 2, 3]);
    expect(await collect(op.apply(emptySource<number>() as any))).toEqual([1, 2, 3]);
    expect(pulls).toBe(4);
  });

  it('replays only the last buffered values in source order', async () => {
    const op = shareReplay<number>(2);
    let next = 0;
    const source: AsyncIterator<number> = {
      next: async () => {
        next++;
        return next <= 3 ? NEXT(next) : DONE;
      },
    };

    expect(await collect(op.apply(source as any))).toEqual([1, 2, 3]);
    expect(await collect(op.apply(emptySource<number>() as any))).toEqual([2, 3]);
  });

  it('propagates source errors to later consumers', async () => {
    const op = shareReplay<number>();
    let calls = 0;
    const source: AsyncIterator<number> = {
      next: async () => {
        calls++;
        if (calls === 1) return NEXT(1);
        throw new Error('Test error');
      },
    };

    await expectAsync(collect(op.apply(source as any))).toBeRejectedWith(jasmine.objectContaining({ message: 'Test error' }));
    await expectAsync(collect(op.apply(emptySource<number>() as any))).toBeRejectedWith(jasmine.objectContaining({ message: 'Test error' }));
  });

  it('cancels extra source iterators while already connected', async () => {
    const op = shareReplay<number>();
    let secondReturnCalls = 0;
    let firstPulls = 0;

    const firstSource: AsyncIterator<number> = {
      next: async () => {
        firstPulls++;
        if (firstPulls === 1) return NEXT(1);
        await wait(20);
        return NEXT(2);
      },
    };

    const secondSource: AsyncIterator<number> = {
      next: async () => DONE,
      return: async () => {
        secondReturnCalls++;
        return DONE;
      },
    };

    const first = op.apply(firstSource as any);
    expect(await first.next()).toEqual(NEXT(1));

    const second = op.apply(secondSource as any);
    expect(await second.next()).toEqual(NEXT(1));
    await second.return?.();

    expect(secondReturnCalls).toBe(1);
  });
});
