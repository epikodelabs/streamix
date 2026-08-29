import { createStream, createSubject, from, share } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('share', () => {
  it('shares a single source across subscribers without replaying past values', async () => {
    const subject = createSubject<number>();
    const shared = subject.pipe(share());

    const first: number[] = [];
    const second: number[] = [];

    const firstReader = (async () => {
      for await (const value of shared) {
        first.push(value);
      }
    })();

    subject.next(1);
    await wait(5);

    const secondReader = (async () => {
      for await (const value of shared) {
        second.push(value);
      }
    })();

    subject.next(2);
    subject.next(3);
    subject.complete();

    await Promise.all([firstReader, secondReader]);

    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([2, 3]);
  });

  it('only subscribes to the source once even when multiple readers attach over time', async () => {
    let subscriptions = 0;
    const source = createStream('counter', async function* () {
      subscriptions++;
      for (const value of [1, 2, 3]) {
        yield value;
        await wait(10);
      }
    });

    const shared = source.pipe(share());
    const first: number[] = [];
    const second: number[] = [];

    const firstRun = (async () => {
      for await (const value of shared) {
        first.push(value);
      }
    })();

    await wait(5);

    const secondRun = (async () => {
      for await (const value of shared) {
        second.push(value);
      }
    })();

    await Promise.all([firstRun, secondRun]);

    expect(subscriptions).toBe(1);
    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([2, 3]);
  });

  it('propagates errors to every subscriber', async () => {
    const subject = createSubject<number>();
    const shared = subject.pipe(share());

    const firstValues: number[] = [];
    let firstError: any = null;
    const firstRun = (async () => {
      try {
        for await (const value of shared) {
          firstValues.push(value);
        }
      } catch (err) {
        firstError = err;
      }
    })();

    const secondValues: number[] = [];
    let secondError: any = null;
    const secondRun = (async () => {
      try {
        for await (const value of shared) {
          secondValues.push(value);
        }
      } catch (err) {
        secondError = err;
      }
    })();

    subject.next(1);
    subject.error(new Error('boom'));

    await Promise.all([firstRun, secondRun]);
    expect(firstValues).toEqual([1]);
    expect(secondValues).toEqual([1]);
    expect(firstError?.message).toBe('boom');
    expect(secondError?.message).toBe('boom');
  });

  it('should handle iterator.throw() call', async () => {
    const subject = createSubject<number>();
    const shared = subject.pipe(share());
    let caughtError: any = null;

    const iterator = shared[Symbol.asyncIterator]();
    
    subject.next(1);
    const firstResult = await iterator.next();
    expect(firstResult.value).toBe(1);
    
    // Call throw() on the iterator
    try {
      await iterator.throw?.(new Error('iterator thrown'));
    } catch (err) {
      caughtError = err;
    }
    
    expect(caughtError?.message).toBe('iterator thrown');
    
    // Iterator should be done
    const nextResult = await iterator.next();
    expect(nextResult.done).toBe(true);
  });

  it('should handle iterator.return() call', async () => {
    const subject = createSubject<number>();
    const shared = subject.pipe(share());

    const iterator = shared[Symbol.asyncIterator]();
    
    subject.next(1);
    const firstResult = await iterator.next();
    expect(firstResult.value).toBe(1);
    
    // Call return() to cleanup early
    const returnResult = await iterator.return?.();
    expect(returnResult?.done).toBe(true);
    
    // Iterator should be done
    const nextResult = await iterator.next();
    expect(nextResult.done).toBe(true);
  });

  it('should not lose synchronous source values for the first subscriber', async () => {
    const shared = from([1, 2, 3]).pipe(share());
    const values: number[] = [];

    for await (const value of shared) {
      values.push(value);
    }

    expect(values).toEqual([1, 2, 3]);
  });

  it('should disconnect the source when the last subscriber throws', async () => {
    let returned = 0;
    let yielded = false;

    const sourceIterator: AsyncIterator<number> = {
      async next() {
        if (yielded) {
          return new Promise<IteratorResult<number>>(() => {});
        }
        yielded = true;
        return { done: false as const, value: 1 };
      },
      async return() {
        returned++;
        return { done: true as const, value: undefined };
      }
    };

    const iterator = share<number>().apply(sourceIterator);
    expect((await iterator.next()).value).toBe(1);
    await expectAsync(iterator.throw?.(new Error('stop'))).toBeRejectedWithError('stop');
    expect(returned).toBe(1);
  });
});
