import {from, iterate, pipe, take} from '@epikodelabs/streamix';

describe('take', () => {
  it('should take specified number of emissions', async () => {
    const atom = pipe(from([1, 2, 3, 4, 5]), take(3));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should handle case where count is greater than number of emissions', async () => {
    const atom = pipe(from([1, 2]), take(5));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2]);
  });

  it('should handle empty stream', async () => {
    const atom = pipe(from([]), take(3));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });
});
