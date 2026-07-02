import { atom, flow, from, race, type Writable } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('race', () => {
  it('should complete without emitting when called with no streams', async () => {
    const results: unknown[] = [];

    race().subscribe(v => { if (v !== undefined) results.push(v); });
    await delay(50);

    expect(results).toEqual([]);
  });

  it('should only emit values from the winning stream', async () => {
    const stream1: Writable = atom<number>();
    const stream2: Writable = atom<number>();
    const results: number[] = [];

    (race(stream1, stream2) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    stream1.next(1);
    stream1.next(2);
    stream2.next(3);

    await delay();

    expect(results).toEqual([1, 2]);
  });

  it('should emit the first value from the winning stream', async () => {
    const stream1: Writable = atom<number>();
    const stream2: Writable = atom<number>();
    const results: number[] = [];

    (race(stream1, stream2) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    stream1.next(1);
    stream2.next(2);

    await delay();

    expect(results).toEqual([1]);
  });

  it('should complete when the winning stream completes', async () => {
    const stream1: Writable = atom<number>();
    const stream2: Writable = atom<number>();
    const results: number[] = [];

    const unsubscribe = (race(stream1, stream2) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    stream1.next(1);
    stream1.dispose();
    stream2.next(2);

    await delay();

    expect(results).toEqual([1]);
    expect(unsubscribe.unsubscribed).toBe(true);
  });

  it('should not crash when the winning stream errors', async () => {
    const stream1: Writable = atom<number>();
    const stream2: Writable = atom<number>();
    const results: number[] = [];

    (race(stream1, stream2) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    stream1.next(1);
    stream1.fail(new Error('test error'));
    stream2.next(2);

    await delay();

    expect(results).toEqual([1]);
  });

  it('should handle multiple streams correctly', async () => {
    const stream1: Writable = atom<number>();
    const stream2: Writable = atom<number>();
    const stream3: Writable = atom<number>();
    const results: number[] = [];

    const unsubscribe = (race(stream1, stream2, stream3) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    stream1.next(1);
    stream2.next(2);
    stream3.next(4);
    stream1.dispose();
    stream2.dispose();
    stream3.dispose();

    await delay();

    expect(results).toEqual([1]);
    expect(unsubscribe.unsubscribed).toBe(true);
  });

  it('should work with streams that emit after a delay', async () => {
    const stream1 = flow<number>( async function* () {
      await delay(10);
      yield 1;
      yield 2;
    });

    const stream2 = flow<number>( async function* () {
      await delay(5);
      yield 3;
      yield 4;
    });

    const results: number[] = [];
    const unsubscribe = (race(stream1, stream2) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    await delay(100);
    unsubscribe();

    expect(results).toEqual([3, 4]);
  });

  it('should complete when the winning stream completes after a delay', async () => {
    const stream1 = flow<number>( async function* () {
      await delay(100);
      yield 1;
    });

    const stream2 = flow<number>( async function* () {
      await delay(50);
      yield 3;
    });

    const results: number[] = [];
    const unsubscribe = (race(stream1, stream2) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    await delay(150);

    expect(results).toEqual([3]);
    expect(unsubscribe.unsubscribed).toBe(true);
  });

  it('should emit nothing if the winning stream completes immediately (and cancel losers)', async () => {
    let cancelled = false;
    let returnCalls = 0;

    const losing = flow<number>( async function* () {
      await delay(50);
      yield 123;
    });

    const originalAsyncIterator = (losing as any)[Symbol.asyncIterator].bind(losing);
    (losing as any)[Symbol.asyncIterator] = () => {
      const it = originalAsyncIterator();
      const originalReturn = it.return?.bind(it);
      if (originalReturn) {
        it.return = (...args: any[]) => {
          returnCalls += 1;
          cancelled = true;
          return originalReturn(...args);
        };
      }
      return it;
    };

    const results: number[] = [];

    (race(from([] as number[]), losing) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    await delay(50);

    expect(results).toEqual([]);

    await delay(0);
    expect(cancelled).toBe(true);
    expect(returnCalls).toBeGreaterThanOrEqual(1);
  });

  it('supports promise inputs', async () => {
    const results: number[] = [];

    (race(Promise.resolve(1), Promise.resolve(2)) as Writable<number | undefined>).subscribe(v => { if (v !== undefined) results.push(v); });

    await delay();

    expect(results.length).toBe(1);
    expect([1, 2]).toContain(results[0]);
  });
});
