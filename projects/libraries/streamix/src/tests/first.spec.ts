import {first, from, iterate, pipe} from '@epikodelabs/streamix';

describe('first', () => {
  it('should emit the first value even when there is a delay', async () => {
    const atom = pipe(from([1, 2, 3, 4]), first());

    await new Promise((resolve) => setTimeout(resolve, 100));

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1]);
  });

  it('should emit the first value of the stream', async () => {
    const atom = pipe(from([1, 2, 3, 4]), first());

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([1]);
  });

  it('should throw for an empty stream', async () => {
    const atom = pipe(from([]), first());

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

  it('should complete immediately after emitting the first value', async () => {
    const atom = pipe(from([10, 20, 30]), first());

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([10]);
  });

  it('should not emit if no values match the predicate', async () => {
    const atom = pipe(from([1, 2, 3, 4]), first((value) => value > 5));

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
