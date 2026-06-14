import { reduce, type Stream } from '@epikodelabs/streamix';

describe('reduce', () => {
  let subject: ReturnType<typeof atom<number>>;
  let source: Stream<number>;

  beforeEach(() => {
    subject = atom<number>();
    source = subject;
  });

  it('should accumulate values from the source stream', async () => {
    const accumulatedStream = source.pipe(reduce((acc, value) => acc + value, 0));  // Sum values
    const results: number[] = [];

    void (async () => {
      for await (const value of accumulatedStream) {
        results.push(value);
      }
    })();

    subject.set(1);
    subject.set(2);
    subject.set(3);
    subject.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([6]);  // 1 + 2 + 3 = 6
  });

  it('should emit the seed value if the stream is empty', async () => {
    const accumulatedStream = source.pipe(reduce((acc, value) => acc + value, 0));  // Sum values
    const results: number[] = [];

    void (async () => {
      for await (const value of accumulatedStream) {
        results.push(value);
      }
    })();

    subject.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([0]);  // Seed value should be emitted
  });

  it('should propagate errors from the source stream', async () => {
    const accumulatedStream = source.pipe(reduce((acc, value) => acc + value, 0));  // Sum values
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of accumulatedStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    subject.error(new Error('Test Error'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(error).toEqual(new Error('Test Error'));  // Propagate error
  });

  it('should emit the accumulated value when stream completes', async () => {
    const accumulatedStream = source.pipe(reduce((acc, value) => acc * value, 1));  // Product of values
    const results: number[] = [];

    void (async () => {
      for await (const value of accumulatedStream) {
        results.push(value);
      }
    })();

    subject.set(2);
    subject.set(3);
    subject.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([6]);  // 1 * 2 * 3 = 6
  });

  it('should work with non-numeric accumulators', async () => {
    let subject = atom<string>();

    const accumulatedStream = subject.pipe(reduce((acc, value) => acc + value, ''));  // Concatenate strings
    const results: string[] = [];

    void (async () => {
      for await (const value of accumulatedStream) {
        results.push(value);
      }
    })();

    subject.set('Hello');
    subject.set(' ');
    subject.set('World');
    subject.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual(['Hello World']);
  });

  it('should handle edge case where accumulator always returns the same value', async () => {
    let subject = atom<string>();
    const accumulatedStream = subject.pipe(reduce(() => 'constant', 'initial'));  // Always return 'constant'
    const results: string[] = [];

    void (async () => {
      for await (const value of accumulatedStream) {
        results.push(value);
      }
    })();

    subject.set('A');
    subject.set('B');
    subject.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual(['constant']);  // The accumulator always returns 'constant'
  });

  it('should await async accumulator before emitting final value', async () => {
    const accumulatedStream = source.pipe(
      reduce(async (acc, value) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return acc + value;
      }, 0)
    );
    const results: number[] = [];

    void (async () => {
      for await (const value of accumulatedStream) {
        results.push(value);
      }
    })();

    subject.set(2);
    subject.set(3);
    subject.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([5]);
  });

  it('should propagate accumulator errors', async () => {
    const accumulatedStream = source.pipe(
      reduce((acc, value) => {
        if (value === 2) {
          throw new Error('Accumulator failure');
        }
        return acc + value;
      }, 0)
    );

    let caught: Error | null = null;

    void (async () => {
      try {
        for await (const _ of accumulatedStream) {
          void _;
        }
      } catch (err) {
        caught = err as Error;
      }
    })();

    subject.set(1);
    subject.set(2);
    await subject.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(caught!.message).toEqual('Accumulator failure');
  });
});


