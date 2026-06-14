import { filter, from, iterate, pipe, atom } from '@epikodelabs/streamix';

describe('filter', () => {
  it('should allow values that pass the predicate', async () => {
    const atom = pipe(
      from([1, 2, 3, 4, 5]),
      filter((value: number) => value % 2 === 0)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([2, 4]);
  });

  it('should not emit values that fail the predicate', async () => {
    const atom = pipe(
      from([1, 2, 3]),
      filter((value: number) => value > 3)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it('should emit all allowed values before stopping', async () => {
    const atom = pipe(
      from([1, 2, 3, 4, 5]),
      filter((value: number) => value <= 3)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should support async predicates', async () => {
    const atom = pipe(
      from([1, 2, 3]),
      filter(async (value: number) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return value % 2 === 1;
      })
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 3]);
  });

  it('should allow filtering by array of values', async () => {
    const atom = pipe(from([1, 2, 3, 4, 5]), filter([2, 4]));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([2, 4]);
  });

  it('should allow filtering by single value', async () => {
    const atom = pipe(from([1, 2, 3]), filter(2));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([2]);
  });

  it('should advance predicate index for every source value, including filtered ones', async () => {
    const indices: number[] = [];
    const atom = pipe(
      from([1, 2, 3]),
      filter((current, index) => {
        indices.push(index);
        return current === 3;
      })
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(indices).toEqual([0, 1, 2]);
    expect(results).toEqual([3]);
  });
});
