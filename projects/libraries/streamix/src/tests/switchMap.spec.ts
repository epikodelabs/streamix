import { atom, DONE, flow, from, iterate, NEXT, pipe, switchMap } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('switchMap', () => {
  it('emits values from the latest inner source for a synchronous source burst', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([1, 2]), switchMap(value => [value, value * 10])))) {
      values.push(value);
    }

    expect(values).toEqual([2, 20]);
  });

  it('drops stale promise results and emits only the latest promise', async () => {
    const source = atom<number>();
    const values: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(
        source,
        switchMap(value => new Promise<number>(resolve => {
          setTimeout(() => resolve(value * 10), value === 1 ? 30 : 1);
        }))
      ))) {
        values.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    await wait(50);
    source.dispose();

    await reader;
    expect(values).toEqual([20]);
  });

  it('cancels the previous inner iterator when a new source value arrives', async () => {
    const source = atom<number>();
    let firstInnerReturned = 0;

    const makeInner = (value: number): AsyncIterable<number> => ({
      [Symbol.asyncIterator]() {
        let emitted = false;
        return {
          next: async () => {
            if (!emitted) {
              emitted = true;
              await wait(value === 1 ? 25 : 0);
              return NEXT(value);
            }
            return new Promise<IteratorResult<number>>(() => {});
          },
          return: async () => {
            if (value === 1) firstInnerReturned++;
            return DONE;
          },
        };
      },
    });

    const values: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, switchMap(makeInner)))) {
        values.push(value);
        if (values.length === 1) break;
      }
    })();

    source.next(1);
    await wait(0);
    source.next(2);

    await reader;
    source.dispose();

    expect(values).toEqual([2]);
    expect(firstInnerReturned).toBe(1);
  });

  it('propagates active inner errors', async () => {
    const source = atom<number>();
    const inner = atom<number>();
    const reader = (async () => {
      for await (const _ of iterate(pipe(source, switchMap(() => inner)))) {
        void _;
      }
    })();

    source.next(1);
    await wait(0);
    inner.fail(new Error('boom'));

    await expectAsync(reader).toBeRejectedWithError('boom');
  });

  it('supports push-based sources via __tryNext and __onPush', async () => {
    const buffer: number[] = [1];
    let done = false;

    const sourceIterator: any = {
      __tryNext() {
        if (buffer.length > 0) return NEXT(buffer.shift()!);
        if (done) return DONE;
        return null;
      },
      next: async () => {
        throw new Error('next() should not be used when __tryNext is present');
      },
    };

    const iterator = switchMap<number, number>(value => from([value, value * 10])).apply(sourceIterator);
    const valuesPromise = (async () => {
      const values: number[] = [];
      for await (const value of { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<number>) {
        values.push(value);
      }
      return values;
    })();

    buffer.push(2, 3);
    sourceIterator.__onPush();
    done = true;
    sourceIterator.__onPush();

    expect(await valuesPromise).toEqual([3, 30]);
  });

  it('returns and throws cleanly', async () => {
    const source = flow<number>(async function* () {
      yield 1;
      await wait(50);
      yield 2;
    });

    const iterator = switchMap<number, number>(value => from([value])).apply(iterate(source)[Symbol.asyncIterator]() as any);
    expect(await iterator.next()).toEqual(NEXT(1));
    expect(await iterator.return?.()).toEqual(DONE);

    const throwing = switchMap<number, number>(value => from([value])).apply(from([1])[Symbol.asyncIterator]() as any);
    expect(await throwing.next()).toEqual(NEXT(1));
    await expectAsync(throwing.throw?.(new Error('stop')) as Promise<any>).toBeRejectedWithError('stop');
  });
});
