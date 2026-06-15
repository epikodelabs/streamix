import { filter, from, iterate, map, pipe } from '@epikodelabs/streamix';

describe('pipe', () => {
  it('can pass the result of one pipe as the input of another', async () => {
    const source = from([1, 2, 3, 4, 5]);

    const doubled = pipe(source, map((value) => value * 2));
    const evens = pipe(doubled, filter((value) => value % 4 === 0));

    const results: number[] = [];
    for await (const value of iterate(evens)) {
      results.push(value);
    }

    expect(results).toEqual([4, 8]);
  });

  it('can chain via the AtomBase.pipe helper', async () => {
    const source = from([1, 2, 3, 4]);

    const result = source
      .pipe(map((value) => value + 1))
      .pipe(filter((value) => value > 2));

    const results: number[] = [];
    for await (const value of iterate(result)) {
      results.push(value);
    }

    expect(results).toEqual([3, 4, 5]);
  });
});
