import { flow, iterate, retry } from '@epikodelabs/streamix';

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('retry', () => {
  it('should retry the stream once and preserve values already emitted by the failed attempt', async () => {
    let attempt = 0;
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return flow<number>( async function* () {
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
    const atom = retry(factory, 3, 1000);

    for await (const value of iterate(atom)) {
      result.push(value);
    }

    expect(result).toEqual([1, 2, 3, 4]);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('should not retry if stream completes successfully on first try', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      return flow<number>( async function* () {
        yield 1;
        yield 2;
      });
    });

    const result: number[] = [];
    const atom = retry(factory, 3, 1000);

    for await (const value of iterate(atom)) {
      result.push(value);
    }

    expect(result).toEqual([1, 2]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should emit error after max retries are reached', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      return flow(async function* () {
        throw new Error('Test Error');
      });
    });

    const result: any[] = [];
    const atom = retry(factory, 2, 500);

    try {
      for await (const value of iterate(atom)) {
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
      return flow(async function* () {
        throw new Error('Immediate failure');
      });
    });

    let caught: Error | null = null;
    try {
      for await (const _ of iterate(retry(factory, 0, 0))) {
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
      for await (const _ of iterate(retry(factory as any, 0, 0))) {
        void _;
      }
    } catch (err) {
      caught = err;
    }

    expect(caught).toEqual(jasmine.any(Error));
    expect((caught as Error).message).toBe("FACTORY_STR");
  });

  it('should emit values from each attempt while retrying', async () => {
    let attempt = 0;
    const factory = () => flow<number>( async function* () {
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
    const atom = retry(factory, 3, 1000);

    try {
      for await (const value of iterate(atom)) {
        result.push(value);
      }
    } catch {
      // ignore
    }

    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('should support promise-like options and a promise-produced plain value', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => Promise.resolve(5));

    const result: number[] = [];
    const atom = retry(factory, Promise.resolve(0), undefined as any);

    for await (const value of iterate(atom)) {
      result.push(value);
    }

    expect(result).toEqual([5]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should not sleep when delay is undefined', async () => {
    let attempt = 0;
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return flow<number>( async function* () {
        if (attempt === 1) {
          throw new Error("fail once");
        }
        yield 7;
      });
    });

    const values: number[] = [];
    for await (const v of iterate(retry(factory, 1, undefined as any))) {
      if (v !== undefined) values.push(v);
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
      return flow<number>( async function* () {
        if (attempt === 1) {
          throw new Error("fail once");
        }
        yield 9;
      });
    });

    const values: number[] = [];
    await Promise.race([
      (async () => {
        for await (const v of iterate(retry(factory, 1, 0))) {
          if (v !== undefined) values.push(v);
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
      return flow<number>( async function* () {
        if (attempt === 1) {
          throw new Error("fail once");
        }
        yield 11;
      });
    });

    const values: number[] = [];
    for await (const v of iterate(retry(factory, 1, 5))) {
      if (v !== undefined) values.push(v);
    }

    expect(values).toEqual([11]);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.calls.allArgs().some((args) => args[1] === 5)).toBe(true);
  });

  it('should stop retrying when unsubscribed during delay', async () => {
    let attempt = 0;
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return flow<number>( async function* () {
        throw new Error("nope");
      });
    });

    const values: number[] = [];
    const atom = retry(factory, 3, 50);

    const unsubscribe = atom.subscribe(v => { if (v !== undefined) values.push(v); });

    await sleep(0);
    unsubscribe();

    await sleep(60);

    expect(values).toEqual([]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should wait for a promised delay before retrying', async () => {
    let attempt = 0;
    let delayResolve!: (value: number) => void;
    const delay$ = new Promise<number>((resolve) => {
      delayResolve = resolve;
    });

    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return flow<number>( async function* () {
        if (attempt === 1) {
          yield 1;
          throw new Error('Need retry');
        }
        yield 2;
      });
    });

    const result: number[] = [];
    void (async () => {
      for await (const value of iterate(retry(factory, 1, delay$))) {
        result.push(value);
      }
    })();

    await sleep(50);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(result).toEqual([1]);

    delayResolve(0);

    await sleep(0);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(result).toEqual([1, 2]);
  });

  it('should abort at loop start when signal is already aborted', async () => {
    const factory = jasmine.createSpy('factory').and.callFake(() => {
      return flow<number>( async function* () {
        yield 1;
      });
    });

    const atom = retry(factory, 1, 0);
    const unsubscribe = atom.subscribe(() => fail('Should not emit'));

    unsubscribe();

    await sleep(10);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should abort during iteration when signal is aborted', async () => {
    let iterationCount = 0;

    const factory = jasmine.createSpy('factory').and.callFake(() => {
      return flow<number>( async function* (signal) {
        while (true) {
          if (signal?.aborted) {
            throw new Error("Stream aborted");
          }
          iterationCount++;
          yield iterationCount;
          await sleep(10);
        }
      });
    });

    const values: number[] = [];
    const atom = retry(factory, 3, 0);

    const unsubscribe = atom.subscribe(v => { if (v !== undefined) values.push(v); });

    await sleep(35);
    unsubscribe();
    await sleep(20);

    expect(iterationCount).toBeGreaterThan(0);
    expect(iterationCount).toBeLessThan(10);
    expect(values.length).toBeGreaterThan(0);
  });

  it('should handle abort during delay and cleanup iterator', async () => {
    let attempt = 0;
    let returnCalled = false;

    const factory = jasmine.createSpy('factory').and.callFake(() => {
      attempt++;
      return flow<number>( async function* () {
        try {
          yield 1;
          throw new Error("Fail for retry");
        } finally {
          returnCalled = true;
        }
      });
    });

    const atom = retry(factory, 2, 100);

    const unsubscribe = atom.subscribe(() => {});

    await sleep(10);
    unsubscribe();
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

      return flow(async function* () {
        for await (const v of gen) {
          yield v;
        }
      });
    });

    let caught: any;
    try {
      for await (const _ of iterate(retry(factory, 0, 0))) {
        void _;
      }
    } catch (err) {
      caught = err;
    }

    expect(factory).toHaveBeenCalled();
    expect(caught).toBeDefined();
  });
});
