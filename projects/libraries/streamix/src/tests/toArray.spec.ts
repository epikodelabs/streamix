import { createAsyncPushable, iterate, pipe, toArray } from '@epikodelabs/streamix';

describe('toArray', () => {
  it('should collect all values and emit them as an array when the stream completes', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(source, toArray());

    const results: number[][] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push(1);
    source.push(2);
    source.push(3);
    source.dispose();
    await finished;

    expect(results).toEqual([[1, 2, 3]]);
  });

  it('should emit an empty array when the stream completes without emitting any values', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(source, toArray());

    const results: number[][] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.dispose();
    await finished;

    expect(results).toEqual([[]]);
  });

  it('should propagate errors from the source stream', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(source, toArray());
    const expectedError = new Error('Test Error');

    let caught: Error | undefined;
    const finished = (async () => {
      try {
        for await (const _ of iterate(atom)) {
          void _;
        }
      } catch (err) {
        caught = err as Error;
      }
    })();

    source.error(expectedError);
    await finished;

    expect(caught).toBe(expectedError);
  });

  it('should handle the stream completing after emitting values', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(source, toArray());

    const results: number[][] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push(10);
    source.push(20);
    source.push(30);
    source.dispose();
    await finished;

    expect(results).toEqual([[10, 20, 30]]);
  });

  it('should handle an edge case where only one value is emitted', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(source, toArray());

    const results: number[][] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push(42);
    source.dispose();
    await finished;

    expect(results).toEqual([[42]]);
  });
});
