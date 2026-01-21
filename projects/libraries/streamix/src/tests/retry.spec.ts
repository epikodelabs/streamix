import { createStream, retry } from "@epikodelabs/streamix";

describe('retry', () => {
  it('should retry the stream once on error and emit correct values', async () => {
    let attempt = 0;
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return createStream<number>('testStream', async function* () {
        if (attempt === 1) {
          yield 1;
          yield 2;
          throw new Error('Test Error');
        } else {
          yield 3;
          yield 4;
        }
      });
    });

    const result: number[] = [];
    const stream$ = retry(factory, 3, 1000);

    for await (const value of stream$) {
      result.push(value);
    }

    expect(result).toEqual([3, 4]);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('should not retry if stream completes successfully on first try', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      return createStream<number>('testStream', async function* () {
        yield 1;
        yield 2;
      });
    });

    const result: number[] = [];
    const stream$ = retry(factory, 3, 1000);

    for await (const value of stream$) {
      result.push(value);
    }

    expect(result).toEqual([1, 2]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should emit error after max retries are reached', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      // Mock the stream and async generator
      return createStream("errorStream", async function* () {
        throw new Error('Test Error');
      });
    });

    const result: any[] = [];
    const stream$ = retry(factory, 2, 500);

    try {
      for await (const value of stream$) {
        result.push(value);
      }
    } catch (error: any) {
      result.push(error.message);
    }

    expect(result).toEqual(['Test Error']);
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('should not retry when maxRetries is zero', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      return createStream("errorStream", async function* () {
        throw new Error('Immediate failure');
      });
    });

    let caught: Error | null = null;
    try {
      for await (const _ of retry(factory, 0, 0)) {
        void _;
      }
    } catch (err: any) {
      caught = err;
    }

    expect(factory).toHaveBeenCalledTimes(1);
    expect(caught).toEqual(new Error('Immediate failure'));
  });

  it('should emit correct values after retrying stream multiple times', async () => {
    let attempt = 0;
    const factory = () => createStream<number>("errorStream", async function* () {
      attempt++;
      if (attempt === 1) {
        yield 1;
        yield 2;
        throw new Error('Test Error');
      } else {
        yield 3;
        yield 4;
      }
    });

    const result: number[] = [];
    const stream$ = retry(factory, 3, 1000);

    try {
      for await (const value of stream$) {
        result.push(value);
      }
    } catch {

    }


    expect(result).toEqual([3, 4]);
  });

  it('should support promise-like options and a promise-produced plain value', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => Promise.resolve(5));

    const result: number[] = [];
    const stream$ = retry(factory, Promise.resolve(0), undefined as any);

    for await (const value of stream$) {
      result.push(value);
    }

    expect(result).toEqual([5]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should wait for a promised delay before retrying', async () => {
    let attempt = 0;
    let delayResolve!: (value: number) => void;
    const delayPromise = new Promise<number>((resolve) => {
      delayResolve = resolve;
    });

    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return createStream<number>("delayedRetry", async function* () {
        if (attempt === 1) {
          yield 1;
          throw new Error('Need retry');
        }
        yield 2;
      });
    });

    const result: number[] = [];
    const consumePromise = (async () => {
      for await (const value of retry(factory, 1, delayPromise)) {
        result.push(value);
      }
    })();

    // Wait for first attempt to complete and fail
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]); // No values emitted yet (buffered from failed attempt)

    // At this point, retry is waiting for delayPromise to resolve
    // Resolve the delay to allow retry
    delayResolve(0);

    // Wait for the retry and completion
    await consumePromise;

    expect(factory).toHaveBeenCalledTimes(2);
    expect(result).toEqual([2]); // Only value from successful attempt
  });
});


