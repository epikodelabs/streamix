import {from, iterate, last, pipe} from '@epikodelabs/streamix';

describe('last', () => {
  it('should emit the last value of the stream', async () => {
    const atom = pipe(from([1, 2, 3, 4]), last());

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([4]);
  });

  it('should emit the last value even when there is a delay', async () => {
    const atom = pipe(from([1, 2, 3, 4]), last());

    await new Promise((resolve) => setTimeout(resolve, 100));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([4]);
  });

  it('should throw for an empty stream', async () => {
    const atom = pipe(from([]), last());

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(atom)) {
        void _;
      }
    } catch (err) {
      caught = err as Error;
    }

    expect(caught?.message).toBe('No elements in sequence');
  });

  it('should emit the last value matching a predicate', async () => {
    const atom = pipe(from([1, 2, 3, 4]), last((value) => value > 2));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([4]);
  });

  it('should not emit if no values match the predicate', async () => {
    const atom = pipe(from([1, 2, 3, 4]), last((value) => value > 5));

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(atom)) {
        void _;
      }
    } catch (err) {
      caught = err as Error;
    }

    expect(caught?.message).toBe('No elements in sequence');
  });
});
