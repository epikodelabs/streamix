import {catchError, from, map, pipe, iterate} from '@epikodelabs/streamix';

describe('map', () => {
  it('should transform values correctly', async () => {
    const transform = (value: number) => value * 2;

    const mappedAtom = pipe(from([1, 2, 3]), map(transform));

    const results: number[] = [];
    for await (const value of iterate(mappedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([2, 4, 6]);
  });

  it('should handle errors in transformation', async () => {
    const transform = (value: number) => {
      if (value === 2) {
        throw new Error('Error in transformation');
      }
      return value * 2;
    };

    const mappedAtom = pipe(from([1, 2, 3]), map(transform), catchError());

    const results: number[] = [];
    for await (const value of iterate(mappedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([2]);
  });

  it('should handle promise-based transformations', async () => {
    const transform = (value: number, index: number) =>
      Promise.resolve(value + index);

    const mappedAtom = pipe(from([1, 2, 3]), map(transform));

    const results: number[] = [];
    for await (const value of iterate(mappedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 3, 5]);
  });
});
