import { atom, fromAtom, createStream, from, race } from "@epikodelabs/streamix";

describe('race', () => {
  it('should complete without emitting when called with no streams', (done) => {
    const results: unknown[] = [];

    race().subscribe({
      next: (v) => results.push(v),
      error: done.fail,
      complete: () => {
        expect(results).toEqual([]);
        done();
      },
    });
  });

  it('should only emit values from the winning stream', (done) => {
    const stream1$ = atom<number>(); const stream1 = fromAtom(stream1$);
    const stream2$ = atom<number>(); const stream2 = fromAtom(stream2$);
    const results: number[] = [];

    const racedStream = race(stream1, stream2);

    racedStream.subscribe({
      next: (value) => {
        results.push(value);
        if (results.length === 2){
          expect(results).toEqual([1,2]);
          done();
        }
      },
      error: done.fail,
      complete: done.fail,
    });

    stream1$.set(1);
    stream1$.set(2);
    stream2$.set(3);
  });

  it('should emit the first value from the winning stream', (done) => {
    const stream1$ = atom<number>(); const stream1 = fromAtom(stream1$);
    const stream2$ = atom<number>(); const stream2 = fromAtom(stream2$);

    const racedStream = race(stream1, stream2);

    racedStream.subscribe({
      next: (value) => {
        expect(value).toBe(1);
        done();
      },
      error: done.fail,
      complete: done.fail,
    });

    stream1$.set(1);
    stream2$.set(2);
  });

  it('should complete when the winning stream completes', (done) => {
    const stream1$ = atom<number>(); const stream1 = fromAtom(stream1$);
    const stream2$ = atom<number>(); const stream2 = fromAtom(stream2$);

    const racedStream = race(stream1, stream2);

    racedStream.subscribe({
      next: (value) => {
        expect(value).toBe(1);
      },
      error: done.fail,
      complete: () => {
        done();
      },
    });

    stream1$.set(1);
    stream1$.dispose();
    stream2$.set(2);
  });

  it('should propagate errors from the winning stream', (done) => {
    const stream1$ = atom<number>(); const stream1 = fromAtom(stream1$);
    const stream2$ = atom<number>(); const stream2 = fromAtom(stream2$);
    const errorMsg = 'test error';

    const racedStream = race(stream1, stream2);

    racedStream.subscribe({
      next: (value) => {
        expect(value).toBe(1);
      },
      error: (err) => {
        expect(err.message).toBe(errorMsg);
        done();
      },
      complete: () => done.fail("Should not complete after error"),
    });

    stream1$.set(1);
    stream1$.setError(new Error(errorMsg));
    stream2$.set(2);
  });

  it('should handle multiple streams correctly', (done) => {
    const stream1$ = atom<number>(); const stream1 = fromAtom(stream1$);
    const stream2$ = atom<number>(); const stream2 = fromAtom(stream2$);
    const stream3$ = atom<number>(); const stream3 = fromAtom(stream3$);
    const results: number[] = [];

    const racedStream = race(stream1, stream2, stream3);

    racedStream.subscribe({
      next: (value) => {
        results.push(value);
      },
      error: done.fail,
      complete: () => {
        expect(results).toEqual([1]);
        done();
      }
    });

    stream1$.set(1);
    stream2$.set(2);
    stream3$.set(4);
    stream1$.dispose();
    stream2$.dispose();
    stream3$.dispose();
  });

  it('should work with streams that emit after a delay', (done) => {
    const stream1 = createStream<number>('delayed1', async function* () {
      await new Promise(resolve => setTimeout(resolve, 10));
      yield 1;
      yield 2;
    });

    const stream2 = createStream<number>('delayed2', async function* () {
      await new Promise(resolve => setTimeout(resolve, 5));
      yield 3;
      yield 4;
    });

    const results: number[] = [];
    const racedStream = race(stream1, stream2);

    racedStream.subscribe({
      next: (value) => {
        results.push(value);
      },
      error: done.fail,
      complete: () => {
        if(results.length === 2){
          expect(results).toEqual([3,4]);
          done();
        } else {
          done.fail();
        }
      }
    });
  });

  it('should complete when the winning stream completes after a delay', (done) => {
    const stream1 = createStream<number>('delayed1', async function* () {
      await new Promise(resolve => setTimeout(resolve, 100));
      yield 1;
    });

    const stream2 = createStream<number>('delayed2', async function* () {
      await new Promise(resolve => setTimeout(resolve, 50));
      yield 3;
    });

    const racedStream = race(stream1, stream2);

    racedStream.subscribe({
      next: (value) => {
        expect(value).toBe(3);
      },
      error: done.fail,
      complete: () => {
        done();
      },
    });
  });

  it('should emit nothing if the winning stream completes immediately (and cancel losers)', async () => {
    let cancelled = false;
    let returnCalls = 0;

    const losing = createStream<number>('losing', async function* () {
      await new Promise(resolve => setTimeout(resolve, 50));
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

    await new Promise<void>((resolve, reject) => {
      race(from([] as number[]), losing).subscribe({
        next: (v) => results.push(v),
        error: reject,
        complete: resolve,
      });
    });

    expect(results).toEqual([]);

    // Allow cancellation microtasks to run.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
    expect(returnCalls).toBeGreaterThanOrEqual(1);
  });

  it('supports promise inputs', async () => {
    const results: number[] = [];

    await new Promise<void>((resolve, reject) => {
      race(Promise.resolve(1), Promise.resolve(2)).subscribe({
        next: (v) => results.push(v),
        error: reject,
        complete: resolve,
      });
    });

    expect(results.length).toBe(1);
    expect([1, 2]).toContain(results[0]);
  });
});


