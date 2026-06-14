import { from, iterate, pipe, skipWhile } from '@epikodelabs/streamix';

describe('skipWhile', () => {
  it('should skip values while the predicate is true', async () => {
    const atom = pipe(
      from([1, 2, 3, 4, 5]),
      skipWhile((value: number) => value < 3)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([3, 4, 5]);
  });

  it('should emit all values if predicate is false initially', async () => {
    const atom = pipe(
      from([3, 4, 5]),
      skipWhile((value: number) => value < 3)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([3, 4, 5]);
  });

  it('should skip all values if predicate is always true', async () => {
    const atom = pipe(
      from([1, 2, 3]),
      skipWhile((value: number) => value < 10)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it('should support index parameter in predicate', async () => {
    const indices: number[] = [];
    const atom = pipe(
      from([10, 20, 30, 40, 50]),
      skipWhile((_, index) => {
        indices.push(index);
        return index < 2;
      })
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([30, 40, 50]);
    expect(indices).toEqual([0, 1, 2]);
  });

  it('should use index to skip based on position not value', async () => {
    const atom = pipe(
      from([100, 100, 100, 100]),
      skipWhile((_, index) => index < 2)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([100, 100]);
  });
});
