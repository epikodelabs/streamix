import { createAsyncPushable, fork, from, iterate, of, pipe } from '@epikodelabs/streamix';

describe('fork', () => {
  it('should handle multiple emissions and match the correct stream', async () => {
    const atom = pipe(
      from([1, 5, 10, 20]),
      fork(
        { on: (value: number) => value <= 5, handler: () => of('Small number') },
        { on: (value: number) => value > 5 && value <= 15, handler: () => of('Medium number') },
        { on: (value: number) => value > 15, handler: () => of('Large number') }
      )
    );

    const results: string[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual(['Small number', 'Small number', 'Medium number', 'Large number']);
  });

  it('should match the correct stream based on conditions', async () => {
    const atom = pipe(
      from([1, 10, 20]),
      fork(
        { on: (value: number) => value <= 5, handler: () => of('Small number') },
        { on: (value: number) => value > 5 && value <= 15, handler: () => of('Medium number') },
        { on: (value: number) => value > 15, handler: () => of('Large number') }
      )
    );

    const results: string[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual(['Small number', 'Medium number', 'Large number']);
  });

  it('should return an error if no case matches', async () => {
    const atom = pipe(
      from([1, 5, 10, 20]),
      fork({ on: (value: number) => value === 100, handler: () => of('Invalid number') })
    );

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(atom)) {
        void _;
      }
    } catch (err) {
      caught = err as Error;
    }

    expect(caught?.message).toBe('No handler found for value: 1');
  });

  it('should handle a custom stream correctly for each case', async () => {
    const atom = pipe(
      of(10),
      fork({ on: (value: number) => value === 10, handler: () => of('Custom stream result') })
    );

    const results: string[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual(['Custom stream result']);
  });

  it('should route rapid emissions based on predicates', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(
      source,
      fork(
        { on: (val) => val === 1, handler: (val) => from([val * 10, val * 100]) },
        { on: (val) => val === 2, handler: (val) => of(val * 10) },
        { on: (val) => val === 3, handler: (val) => [val * 10, val * 100] }
      )
    );

    const results: number[] = [];
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

    expect(results).toEqual([10, 100, 20, 30, 300]);
  });

  it('should handle predicates with index parameter in rapid emissions', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(
      source,
      fork(
        { on: (_, index) => index === 0, handler: (val) => from([val * 10, val * 100]) },
        { on: (_, index) => index === 1, handler: (val) => of(val * 10) },
        { on: (_, index) => index === 2, handler: (val) => of(val * 10) }
      )
    );

    const results: number[] = [];
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

    expect(results).toEqual([10, 100, 20, 30]);
  });

  it('should handle async predicates during rapid emissions', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(
      source,
      fork(
        {
          on: async (val) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return val < 2;
          },
          handler: (val) => from([val * 10])
        },
        {
          on: async (val) => {
            await new Promise(resolve => setTimeout(resolve, 5));
            return val >= 2;
          },
          handler: (val) => of(val * 100)
        }
      )
    );

    const results: number[] = [];
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

    expect(results).toEqual([10, 200, 300]);
  });

  it('should handle mixed handler types (stream, promise, array, scalar)', async () => {
    const source = createAsyncPushable<number>();
    const atom = pipe(
      source,
      fork(
        { on: (val) => val === 1, handler: (val) => from([val * 10]) },
        { on: (val) => val === 2, handler: (val) => new Promise<number>((resolve) => setTimeout(() => resolve(val * 10), 10)) },
        { on: (val) => val === 3, handler: (val) => [val * 10, val * 100] },
        { on: (val) => val === 4, handler: (val) => val * 10 }
      )
    );

    const results: number[] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push(1);
    source.push(2);
    source.push(3);
    source.push(4);
    source.dispose();
    await finished;

    expect(results).toEqual([10, 20, 30, 300, 40]);
  });

  it('should handle sequential routing with rapid emissions', async () => {
    const source = createAsyncPushable<string>();
    const atom = pipe(
      source,
      fork(
        { on: (val) => val.startsWith('a'), handler: (val) => of(`[A:${val}]`) },
        { on: (val) => val.startsWith('b'), handler: (val) => of(`[B:${val}]`) },
        { on: () => true, handler: (val) => of(`[?:${val}]`) }
      )
    );

    const results: string[] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push('apple');
    source.push('banana');
    source.push('cherry');
    source.dispose();
    await finished;

    expect(results).toEqual(['[A:apple]', '[B:banana]', '[?:cherry]']);
  });
});
