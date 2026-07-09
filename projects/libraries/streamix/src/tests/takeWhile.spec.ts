import {from, iterate, pipe, takeWhile} from '@epikodelabs/streamix';

describe('takeWhile', () => {
  it('should take emissions while predicate returns true', async () => {
    const atom = pipe(
      from([1, 2, 3, 4, 5]),
      takeWhile((value: number) => value < 4)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should handle empty stream', async () => {
    const atom = pipe(from([]), takeWhile(() => true));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it('should handle immediate false predicate', async () => {
    const atom = pipe(
      from([1, 2, 3]),
      takeWhile((value: number) => value > 3)
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
      takeWhile((_, index) => {
        indices.push(index);
        return index < 2;
      })
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([10, 20]);
    expect(indices).toEqual([0, 1, 2]);
  });

  it('should use index to take based on position not value', async () => {
    const atom = pipe(
      from([100, 100, 100, 100, 100]),
      takeWhile((_, index) => index < 3)
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([100, 100, 100]);
  });

  it('should support async predicates and remain done after the first failure', async () => {
    const iterator = takeWhile<number>(async (value) => value < 2).apply(
      from([1, 2, 3])[Symbol.asyncIterator]()
    );

    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
