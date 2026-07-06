import { catchError, from, iterate, pipe, scan } from '@epikodelabs/streamix';

describe('scan', () => {
  it('emits intermediate accumulated values', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([1, 2, 3]), scan((acc, next) => acc + next, 0)))) {
      values.push(value);
    }

    expect(values).toEqual([1, 3, 6]);
  });

  it('passes the zero-based source index to the accumulator', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([10, 10, 10]), scan((acc, next, index) => acc + next + index, 0)))) {
      values.push(value);
    }

    expect(values).toEqual([10, 21, 33]);
  });

  it('supports async accumulators', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(
      from([1, 2, 3]),
      scan(async (acc, next) => {
        await Promise.resolve();
        return acc + next;
      }, 0)
    ))) {
      values.push(value);
    }

    expect(values).toEqual([1, 3, 6]);
  });

  it('can recover from accumulator errors with catchError', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(
      from([1, 2, 3]),
      scan((acc, next) => {
        if (next === 2) throw new Error('Error in accumulation');
        return acc + next;
      }, 0),
      catchError()
    ))) {
      values.push(value);
    }

    expect(values).toEqual([1]);
  });
});
