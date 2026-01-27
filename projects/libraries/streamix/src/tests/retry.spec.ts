import { createStream, retry } from "@epikodelabs/streamix";

describe('retry', () => {
  const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

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

  it('should wrap non-Error factory throws as Error', async () => {
    const factory = () => {
      throw "FACTORY_STR";
    };

    let caught: any;
    try {
      for await (const _ of retry(factory as any, 0, 0)) {
        void _;
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toEqual(jasmine.any(Error));
    expect((caught as Error).message).toBe("FACTORY_STR");
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

  it('should not sleep when delay is undefined', async () => {
    let attempt = 0;
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return createStream<number>("noDelay", async function* () {
        if (attempt === 1) {
          throw new Error("fail once");
        }
        yield 7;
      });
    });

    const values: number[] = [];
    for await (const v of retry(factory, 1, undefined as any)) {
      values.push(v);
    }

    expect(values).toEqual([7]);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('should not sleep when delay is 0', async () => {
    let attempt = 0;
    const callTimes: number[] = [];
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      callTimes.push(Date.now());
      attempt++;
      return createStream<number>("zeroDelay", async function* () {
        if (attempt === 1) {
          throw new Error("fail once");
        }
        yield 9;
      });
    });

    const values: number[] = [];
    await Promise.race([
      (async () => {
        for await (const v of retry(factory, 1, 0)) {
          values.push(v);
        }
      })(),
      sleep(250).then(() => {
        throw new Error("Timed out");
      }),
    ]);

    expect(values).toEqual([9]);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(callTimes.length).toBe(2);
    expect(callTimes[1] - callTimes[0]).toBeLessThan(50);
  });

  it('should sleep between retries when delay > 0', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = spyOn(globalThis, "setTimeout").and.callFake(
      ((fn: any, ms?: any, ...rest: any[]) =>
        (originalSetTimeout as any)(fn, ms, ...rest)) as any
    );

    let attempt = 0;
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return createStream<number>("sleepyRetry", async function* () {
        if (attempt === 1) {
          throw new Error("fail once");
        }
        yield 11;
      });
    });

    const values: number[] = [];
    for await (const v of retry(factory, 1, 5)) {
      values.push(v);
    }

    expect(values).toEqual([11]);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.calls.allArgs().some((args) => args[1] === 5)).toBe(true);
  });

  it('should stop retrying when unsubscribed during delay', async () => {
    let attempt = 0;
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return createStream<number>("alwaysFail", async function* () {
        throw new Error("nope");
      });
    });

    const values: number[] = [];
    const stream$ = retry(factory, 3, 50);

    const sub = stream$.subscribe({
      next: (v) => values.push(v),
      error: () => fail("Unexpected error"),
      complete: () => {},
    });

    // Let attempt #1 run and enter the delay sleep.
    await sleep(0);

    // Abort during the delay window so the sleep promise rejects via abort handler.
    sub.unsubscribe();

    await sleep(60);

    expect(values).toEqual([]);
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

  it('should abort at loop start when signal is already aborted', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      return createStream<number>("testStream", async function* () {
        yield 1;
      });
    });

    const stream$ = retry(factory, 1, 0);
    const sub = stream$.subscribe({
      next: () => fail('Should not emit'),
      error: () => {},
      complete: () => {},
    });

    // Immediately abort
    sub.unsubscribe();

    await sleep(10);

    // Factory should be called once before abort check
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should abort during iteration when signal is aborted', async () => {
    let iterationCount = 0;
    let abortCheckCount = 0;
    
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      return createStream<number>("slowStream", async function* (signal) {
        while (true) {
          // Check if signal was aborted
          if (signal?.aborted) {
            abortCheckCount++;
            throw new Error("Stream aborted");
          }
          iterationCount++;
          yield iterationCount;
          await sleep(10);
        }
      });
    });

    const values: number[] = [];
    const stream$ = retry(factory, 3, 0);
    
    const sub = stream$.subscribe({
      next: (v) => values.push(v),
      error: () => {},
      complete: () => {},
    });

    // Let a few iterations happen (values are buffered, not emitted yet)
    await sleep(35);
    
    // Abort during iteration
    sub.unsubscribe();
    
    await sleep(20);

    // Since retry buffers values, no values will be emitted before abort
    // But we can verify that iterations started and then stopped
    expect(iterationCount).toBeGreaterThan(0);
    expect(iterationCount).toBeLessThan(10); // Should stop before too many iterations
    expect(values.length).toBe(0); // No values yielded due to abort during buffering
  });

  it('should handle abort during delay and cleanup iterator', async () => {
    let attempt = 0;
    let returnCalled = false;
    
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return createStream<number>("cleanupTest", async function* () {
        try {
          yield 1;
          throw new Error("Fail for retry");
        } finally {
          returnCalled = true;
        }
      });
    });

    const stream$ = retry(factory, 2, 100);
    
    const sub = stream$.subscribe({
      next: () => {},
      error: () => {},
      complete: () => {},
    });

    // Wait for first attempt to fail
    await sleep(10);
    
    // Abort during the delay
    sub.unsubscribe();
    
    await sleep(50);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(returnCalled).toBe(true);
  });

  it('should cleanup iterator on error even if return throws', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      const gen = (async function* () {
        yield 1;
        throw new Error("Fail");
      })();

      gen.return = async () => {
        throw new Error("Return error");
      };
      
      return createStream("throwOnReturn", async function* () {
        for await (const v of gen) {
          yield v;
        }
      });
    });

    let caught: any;
    try {
      for await (const _ of retry(factory, 0, 0)) {
        void _;
      }
    } catch (err) {
      caught = err;
    }

    expect(factory).toHaveBeenCalled();
    expect(caught).toBeDefined();
  });
});
