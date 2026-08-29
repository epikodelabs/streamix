import { createAsyncPushable, from, iterate, pipe, withLatestFrom } from '@epikodelabs/streamix';

describe('withLatestFrom', () => {
  it('should combine emissions with the latest value from another stream', async () => {
    const atom = pipe(
      from([1, 2, 3]),
      withLatestFrom(from(['A', 'B', 'C', 'D', 'E']))
    );

    const results: Array<[number, string]> = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results.length).toBe(3);
    results.forEach((tuple) => {
      expect(typeof tuple[0]).toBe('number');
      expect(typeof tuple[1]).toBe('string');
    });
  });

  it('should support passing streams as a single array argument', async () => {
    const atom = pipe(
      from([1, 2, 3]),
      withLatestFrom([from(['A', 'B', 'C'])])
    );

    const results: any[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results.length).toBe(3);
  });

  it('should handle a single-value auxiliary stream', async () => {
    const atom = pipe(
      from([1, 2, 3]),
      withLatestFrom(from(['A']))
    );

    const results: Array<[number, string]> = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([
      [1, 'A'],
      [2, 'A'],
      [3, 'A'],
    ]);
  });

  it('should emit nothing when called with no auxiliary streams', async () => {
    const atom = pipe(from([1, 2, 3]), withLatestFrom());

    const results: any[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it('should support promise-wrapped auxiliary streams', async () => {
    const atom = pipe(
      from([1, 2]),
      withLatestFrom(Promise.resolve(from(['Z'])))
    );

    const results: Array<[number, string]> = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([
      [1, 'Z'],
      [2, 'Z'],
    ]);
  });

  it('should support auxiliary inputs that are plain values and promises', async () => {
    const atom = pipe(
      from([1, 2]),
      withLatestFrom(100 as any, Promise.resolve('X') as any)
    );

    const results: any[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([
      [1, 100, 'X'],
      [2, 100, 'X'],
    ]);
  });

  it('should not emit until all auxiliary streams have a value', async () => {
    const main = createAsyncPushable<number>();
    const aux = createAsyncPushable<string>();

    const atom = pipe(main, withLatestFrom(aux));

    const results: any[] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    main.push(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(results).toEqual([]);

    aux.push('A');
    await new Promise((resolve) => setTimeout(resolve, 0));

    main.push(2);
    main.dispose();
    aux.dispose();
    await finished;

    expect(results).toEqual([[2, 'A']]);
  });

  it('should propagate errors from auxiliary streams', async () => {
    const main = createAsyncPushable<number>();
    const aux = createAsyncPushable<string>();

    const atom = pipe(main, withLatestFrom(aux));

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

    aux.fail(new Error('AUX'));
    await finished;

    expect(caught?.message).toBe('AUX');
  });

  it('should propagate errors from the main stream', async () => {
    const main = createAsyncPushable<number>();
    const aux = createAsyncPushable<string>();

    const atom = pipe(main, withLatestFrom(aux));

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

    aux.push('A');
    main.push(1);
    main.fail(new Error('MAIN'));
    await finished;

    expect(caught?.message).toBe('MAIN');
  });

  it('should emit nothing when a pull-based auxiliary stream completes without a value', async () => {
    const atom = pipe(
      from([1, 2, 3]),
      withLatestFrom(from([] as string[]))
    );

    const results: Array<[number, string]> = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it('should keep dropping push-source values when a synchronous auxiliary has no initial value', async () => {
    const main = createAsyncPushable<number>();
    const atom = pipe(main, withLatestFrom(from([] as string[])));
    const results: Array<[number, string]> = [];

    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    main.push(1);
    main.push(2);
    main.dispose();
    await finished;

    expect(results).toEqual([]);
  });

  it('should synchronously preload auxiliary values for push-based sources', async () => {
    const main = createAsyncPushable<number>();
    const atom = pipe(main, withLatestFrom(from(['A'])));
    const results: Array<[number, string]> = [];

    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 0));
    main.push(1);
    main.dispose();
    await finished;

    expect(results).toEqual([[1, 'A']]);
  });

  it('should preload synchronous auxiliary values when the operator is applied directly to a push source', async () => {
    const main = createAsyncPushable<number>();
    const atom = withLatestFrom(from(['A'])).apply(main as any) as unknown as AsyncIterable<[number, string]>;
    const results: Array<[number, string]> = [];

    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 0));
    main.push(1);
    main.dispose();
    await finished;

    expect(results).toEqual([[1, 'A']]);
  });

  it('should synchronously drain a buffered auxiliary push source during setup', async () => {
    const main = createAsyncPushable<number>();
    const aux = createAsyncPushable<string>();
    aux.push('A');

    const atom = withLatestFrom(aux).apply(main as any) as unknown as AsyncIterable<[number, string]>;
    const results: Array<[number, string]> = [];

    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 0));
    main.push(1);
    main.dispose();
    aux.dispose();
    await finished;

    expect(results).toEqual([[1, 'A']]);
  });

  it('completes when the source completes before an auxiliary emits', async () => {
    const never: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => {}),
          return: async () => ({ done: true, value: undefined as any }),
        };
      },
    };

    const atom = pipe(from([1, 2]), withLatestFrom(never));
    const values = await Promise.race([
      (async () => {
        const result: Array<[number, string]> = [];
        for await (const value of iterate(atom)) result.push(value);
        return result;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timed out')), 50)
      ),
    ]);

    expect(values).toEqual([]);
  });

  it('should fail when an auxiliary promise rejects during setup', async () => {
    const atom = pipe(from([1]), withLatestFrom(Promise.reject(new Error('aux setup failed')) as any));

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(atom)) {
        void _;
      }
    } catch (err) {
      caught = err as Error;
    }

    expect(caught?.message).toBe('aux setup failed');
  });
});