import {
  atom,
  derived,
  finalize,
  forkJoin,
  from,
  interval,
  iterate,
  pipe,
  race,
  createAsyncPushable,
  switchMap,
  take,
  transaction,
  withLatestFrom,
  zip,
} from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function drain<T>(source: any): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterate(source)) {
    values.push(value);
  }
  return values;
}

describe('regression: engine fixes', () => {
  it('updates previous for writes made by subscribers during a transaction commit', () => {
    const a = atom(0);
    const seen: Array<[number, number]> = [];

    a.subscribe((current) => {
      if (current === 1) a.set(2);
      seen.push([current, a.previous]);
    });

    transaction(() => a.set(1));

    expect(seen).toEqual([[1, 0], [2, 1]]);
    expect(a.previous).toBe(1);
  });

  it('recovers a derived atom whose first evaluation threw once a dependency changes', () => {
    const source = atom(1);
    const d = derived(() => {
      if (source.value === 1) throw new Error('not ready');
      return source.value * 2;
    });

    expect(() => d.value).toThrowError('not ready');

    source.set(2);
    expect(d.value).toBe(4);
  });

  it('removes finished iterators from the atom dispose handlers', async () => {
    const a = atom(0);

    for (let i = 0; i < 5; i++) {
      for await (const _ of iterate(a)) {
        void _;
        break;
      }
    }

    expect((a as any)._onDispose.size).toBe(0);
  });

  it('delivers values written by a subscriber callback sequentially without re-entering it', () => {
    const a = atom(0);
    const order: number[] = [];
    let reentered = false;

    a.subscribe((current) => {
      if (current > 0 && current < 50) {
        a.set(current + 1);
        // If the runtime re-entered this callback synchronously, `order`
        // would already contain the follow-up value at this point.
        reentered = order.includes(current + 1);
      }
      order.push(current);
    });

    a.set(1);

    expect(reentered).toBe(false);
    expect(order).toEqual([1, 2]);
  });
});

describe('regression: operator fixes', () => {
  it('take(n) consumes exactly n values from the source', async () => {
    let produced = 0;
    function* source() {
      for (let i = 1; ; i++) {
        produced++;
        yield i;
      }
    }

    const values = await drain(pipe(source(), take(2)));

    expect(values).toEqual([1, 2]);
    expect(produced).toBe(2);
  });

  it('withLatestFrom completes when the main source completes while an auxiliary stays open', async () => {
    const values = await drain(pipe(from(['a', 'b']), withLatestFrom(interval(50))));

    expect(values.length).toBe(2);
    expect(values[0][0]).toBe('a');
    expect(values[1][0]).toBe('b');
  });

  it('finalize operators are reusable across separate streams', async () => {
    let calls = 0;
    const fin = finalize(() => { calls++; });

    expect(await drain(pipe(from([1]), fin))).toEqual([1]);
    expect(await drain(pipe(from([9, 9]), fin))).toEqual([9, 9]);
    expect(calls).toBe(2);
  });

  it('switchMap waits for an in-flight promise projection before completing', async () => {
    const values = await drain(pipe(
      from([1]),
      switchMap((value: number) => new Promise<number[]>((resolve) => {
        setTimeout(() => resolve([value, value * 10]), 30);
      })),
    ));

    expect(values).toEqual([1, 10]);
  });

  it('expand depth traversal explores children before siblings', async () => {
    const { expand } = await import('@epikodelabs/streamix');
    // Tree: A -> [B, C]; B -> [D]. Depth-first visits A, B, D, C.
    const children: Record<string, string[]> = { A: ['B', 'C'], B: ['D'], C: [], D: [] };

    const values = await drain(pipe(
      from(['A']),
      expand((node: string) => children[node] ?? []),
    ));

    expect(values).toEqual(['A', 'B', 'D', 'C']);
  });
});

describe('regression: factory fixes', () => {
  it('race delivers the winner without waiting for loser teardown', async () => {
    async function* fast() {
      yield 'fast';
    }
    async function* slow() {
      await wait(300);
      yield 'slow';
    }

    const started = Date.now();
    const values: string[] = [];
    for await (const value of iterate(race(fast(), slow()))) {
      values.push(value);
      break;
    }
    const elapsed = Date.now() - started;

    expect(values).toEqual(['fast']);
    // The unfixed implementation blocked the winner behind the loser's
    // in-flight 300ms pull before delivering the first value.
    expect(elapsed).toBeLessThan(150);
  });

  it('zip buffers multiple values from one source while waiting for its partner', async () => {
    const left = createAsyncPushable<number>();
    const right = createAsyncPushable<string>();

    const collected = drain(zip(left, right));

    left.push(1);
    left.push(2);
    await wait(10);
    right.push('x');
    right.push('y');
    await wait(10);

    const values = await collected;
    expect(values).toEqual([[1, 'x'], [2, 'y']]);
  });

  it('forkJoin with no sources completes without emitting', async () => {
    expect(await drain(forkJoin())).toEqual([]);
    expect(await drain(forkJoin([]))).toEqual([]);
  });
});
