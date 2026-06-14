import { from, pipe, slidingPair, iterate } from "@epikodelabs/streamix";

describe('slidingPair', () => {
  it('should emit pairs of consecutive values', async () => {
    const atom = pipe(from([1, 2, 3, 4]), slidingPair());

    const results: [number | undefined, number][] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([
      [undefined, 1],
      [1, 2],
      [2, 3],
      [3, 4]
    ]);
  });

  it('should handle a stream with a single value', async () => {
    const atom = pipe(from([1]), slidingPair());

    const results: [number | undefined, number][] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([[undefined, 1]]);
  });

  it('should handle an empty stream', async () => {
    const atom = pipe(from([]), slidingPair());

    const results: [number | undefined, number][] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });
});
