import { atom, fromAtom, throttle } from '@epikodelabs/streamix';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('throttle', () => {
  it('should emit first value immediately and throttle subsequent values', async () => {
    const output: number[] = [];
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const iter = subject.pipe(throttle<number>(50));

    void (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    source$.set(1);  // t0, should emit immediately
    source$.set(2);  // t0 + 0ms, should be throttled
    await new Promise((r) => setTimeout(r, 30));
    source$.set(3);  // t0 + 30ms, should replace pending
    await new Promise((r) => setTimeout(r, 30));
    source$.set(4);  // t0 + 60ms, after first throttle window
    source$.dispose();

    // Wait for trailing emissions
    await new Promise((r) => setTimeout(r, 50));

    // Check results
    expect(output[0]).toBe(1); // first emitted immediately
    expect(output).toContain(3); // trailing value from first window
    expect(output).toContain(4); // value after throttle window
    expect(output.length).toBe(3);
  });

  it('should complete after source completes', async () => {
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const iter = subject.pipe(throttle<number>(50));

    let completed = false;
    void (async () => {
      for await (const _ of iter) { void _; }
      completed = true;
    })();

    source$.set(1);
    source$.set(2);
    source$.dispose();

    await new Promise((r) => setTimeout(r, 100));

    expect(completed).toBe(true);
  });

  it('should forward errors from the source', async () => {
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const iter = subject.pipe(throttle<number>(50));

    let caught: any = null;
    void (async () => {
      try {
        for await (const _ of iter) { void _; }
      } catch (err) {
        caught = err;
      }
    })();

    const error = new Error('test error');
    source$.setError(error);

    await new Promise((r) => setTimeout(r, 50));

    expect(caught).toBe(error);
  });

  it('should flush the trailing value when the source completes during cooldown', async () => {
    const output: number[] = [];
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const iter = subject.pipe(throttle<number>(50));

    void (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.dispose();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(output).toEqual([1, 2]);
  });

  it('should emit every value when values are spaced beyond duration', async () => {
    const output: number[] = [];
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const iter = subject.pipe(throttle<number>(20));

    const consumer = (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    source$.set(1);
    await sleep(30);
    source$.set(2);
    await sleep(30);
    source$.set(3);
    source$.dispose();

    await consumer;
    expect(output).toEqual([1, 2, 3]);
  });

  it('should not throttle when duration is 0', async () => {
    const output: number[] = [];
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    const iter = subject.pipe(throttle<number>(0));

    void (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.dispose();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(output).toEqual([1, 2, 3]);
  });

  it('should support promised duration', async () => {
    const output: number[] = [];
    const source$ = atom<number>();
    const subject = fromAtom(source$);
    // Use a generous duration to avoid flakiness under heavy test load.
    // If the event loop is blocked long enough, a short throttle window can
    // legitimately elapse before the next value is emitted, causing an extra
    // trailing emission and making this test timing-sensitive.
    const iter = subject.pipe(throttle<number>(Promise.resolve(200)));

    void (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));

    source$.set(1);
    source$.set(2);
    await sleep(20);
    source$.set(3);
    source$.dispose();

    await new Promise((resolve) => setTimeout(resolve, 0));


    expect(output[0]).toBe(1);
    expect(output).toContain(3);
    expect(output.length).toBe(2);
  });
});
