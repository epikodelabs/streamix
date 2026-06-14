import { from, iterate, pipe, skip } from '@epikodelabs/streamix';

describe('skip', () => {
  it('should skip the specified number of emissions', async () => {
    const atom = pipe(from([1, 2, 3, 4, 5]), skip(3));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([4, 5]);
  });

  it('should handle skip count larger than stream length', async () => {
    const atom = pipe(from([1, 2, 3]), skip(5));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it('should handle skip count of zero', async () => {
    const atom = pipe(from([1, 2, 3]), skip(0));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });
});
