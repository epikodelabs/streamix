import { DONE, NEXT, shareReplay } from '@epikodelabs/streamix';

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
