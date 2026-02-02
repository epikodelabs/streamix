import { createSubject, throttle } from '@epikodelabs/streamix';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('throttle', () => {
  it('should emit first value immediately and throttle subsequent values', async () => {
    const output: number[] = [];
    const subject = createSubject<number>();
    const iter = subject.pipe(throttle<number>(50));

    (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    subject.next(1);  // t0, should emit immediately
    subject.next(2);  // t0 + 0ms, should be throttled
    await new Promise((r) => setTimeout(r, 30));
    subject.next(3);  // t0 + 30ms, should replace pending
    await new Promise((r) => setTimeout(r, 30));
    subject.next(4);  // t0 + 60ms, after first throttle window
    subject.complete();

    // Wait for trailing emissions
    await new Promise((r) => setTimeout(r, 50));

    // Check results
    expect(output[0]).toBe(1); // first emitted immediately
    expect(output).toContain(3); // trailing value from first window
    expect(output).toContain(4); // value after throttle window
    expect(output.length).toBe(3);
  });

  it('should complete after source completes', async () => {
    const subject = createSubject<number>();
    const iter = subject.pipe(throttle<number>(50));

    let completed = false;
    (async () => {
      for await (const _ of iter) { void _; }
      completed = true;
    })();

    subject.next(1);
    subject.next(2);
    subject.complete();

    await new Promise((r) => setTimeout(r, 100));

    expect(completed).toBe(true);
  });

  it('should forward errors from the source', async () => {
    const subject = createSubject<number>();
    const iter = subject.pipe(throttle<number>(50));

    let caught: any = null;
    (async () => {
      try {
        for await (const _ of iter) { void _; }
      } catch (err) {
        caught = err;
      }
    })();

    const error = new Error('test error');
    subject.error(error);

    await new Promise((r) => setTimeout(r, 50));

    expect(caught).toBe(error);
  });

  it('should flush the trailing value when the source completes during cooldown', async () => {
    const output: number[] = [];
    const subject = createSubject<number>();
    const iter = subject.pipe(throttle<number>(50));

    const consumer = (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.complete();

    await consumer;

    expect(output).toEqual([1, 2]);
  });

  it('should emit every value when values are spaced beyond duration', async () => {
    const output: number[] = [];
    const subject = createSubject<number>();
    const iter = subject.pipe(throttle<number>(20));

    const consumer = (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    subject.next(1);
    await sleep(30);
    subject.next(2);
    await sleep(30);
    subject.next(3);
    subject.complete();

    await consumer;
    expect(output).toEqual([1, 2, 3]);
  });

  it('should not throttle when duration is 0', async () => {
    const output: number[] = [];
    const subject = createSubject<number>();
    const iter = subject.pipe(throttle<number>(0));

    const consumer = (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    subject.next(1);
    subject.next(2);
    subject.next(3);
    subject.complete();

    await consumer;
    expect(output).toEqual([1, 2, 3]);
  });

  it('should support promised duration', async () => {
    const output: number[] = [];
    const subject = createSubject<number>();
    // Use a generous duration to avoid flakiness under heavy test load.
    // If the event loop is blocked long enough, a short throttle window can
    // legitimately elapse before the next value is emitted, causing an extra
    // trailing emission and making this test timing-sensitive.
    const iter = subject.pipe(throttle<number>(Promise.resolve(200)));

    const consumer = (async () => {
      for await (const v of iter) {
        output.push(v);
      }
    })();

    // Allow the operator to resolve the duration and start consuming.
    await Promise.resolve();

    subject.next(1);
    subject.next(2);
    await sleep(20);
    subject.next(3);
    subject.complete();

    await consumer;

    expect(output[0]).toBe(1);
    expect(output).toContain(3);
    expect(output.length).toBe(2);
  });
});


