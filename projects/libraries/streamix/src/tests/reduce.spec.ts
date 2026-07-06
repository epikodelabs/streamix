import { catchError, flow, from, iterate, pipe, reduce } from '@epikodelabs/streamix';

describe('reduce', () => {
  it('accumulates values and emits only the final value', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([1, 2, 3]), reduce((acc, next) => acc + next, 0)))) {
      values.push(value);
    }

    expect(values).toEqual([6]);
  });

  it('emits the seed for an empty source', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([] as number[]), reduce((acc, next) => acc + next, 0)))) {
      values.push(value);
    }

    expect(values).toEqual([0]);
  });

  it('supports async accumulators', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(
      from([2, 3]),
      reduce(async (acc, next) => {
        await Promise.resolve();
        return acc + next;
      }, 0)
    ))) {
      values.push(value);
    }

    expect(values).toEqual([5]);
  });

  it('propagates accumulator errors through catchError', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(
      from([1, 2, 3]),
      reduce((acc, next) => {
        if (next === 2) throw new Error('Accumulator failure');
        return acc + next;
      }, 0),
      catchError()
    ))) {
      values.push(value);
    }

    expect(values).toEqual([]);
  });

  it('propagates source errors', async () => {
    const expected = new Error('source failed');
    const source = flow<number>(async function* () {
      yield 1;
      throw expected;
    });

    const reader = (async () => {
      for await (const _ of iterate(pipe(source, reduce((acc, next) => acc + next, 0)))) {
        void _;
      }
    })();

    await expectAsync(reader).toBeRejectedWith(expected);
  });
});
