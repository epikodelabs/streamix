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
  it('should ignore source.return errors when stopping after the limit', async () => {
    const source = {
      index: 0,
      async next() {
        this.index++;
        if (this.index === 1) return { value: 1, done: false as const };
        if (this.index === 2) return { value: 2, done: false as const };
        return { value: undefined, done: true as const };
      },
      async return() {
        throw new Error('ignored');
      }
    } as AsyncIterator<number> & { index: number };

    const iterator = take<number>(1).apply(source);

    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
