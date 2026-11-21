import { flow, delay, from, iterate, pipe } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('delay', () => {
  it('should delay each value by the specified time', async () => {
    const source = from([1, 2, 3]);
    const delayTime = 100;

    const delayedAtom = pipe(source, delay(delayTime));

    const startTime = Date.now();
    const emittedTimes: number[] = [];
    for await (const _ of iterate(delayedAtom)) {
      emittedTimes.push(Date.now() - startTime);
    }

    expect(emittedTimes.length).toBe(3);
    emittedTimes.forEach((elapsed, i) => {
      expect(elapsed + 5).toBeGreaterThanOrEqual((i + 1) * delayTime);
    });
  });

  it('should stop emitting if the stream is cancelled', async () => {
    const source = from([1, 2, 3]);
    const delayTime = 1000;

    const delayedAtom = pipe(source, delay(delayTime));

    const results: number[] = [];
    for await (const value of iterate(delayedAtom)) {
      results.push(value);
      if (results.length === 2) {
        break;
      }
    }

    await wait(200);
    expect(results).toEqual([1, 2]);
  });

  it('should emit all values with delay before stopping', async () => {
    const source = from([1, 2, 3, 4, 5]);
    const delayTime = 100;

    const delayedAtom = pipe(source, delay(delayTime));
    const results: number[] = [];
    for await (const value of iterate(delayedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it('should treat undefined delay durations as immediate', async () => {
    const source = from([42]);
    const delayedAtom = pipe(source, delay(undefined as any));
    const startTime = Date.now();

    const results: number[] = [];
    for await (const value of iterate(delayedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([42]);
    expect(Date.now() - startTime).toBeLessThan(10);
  });

  it('should forward source errors through the delay operator', async () => {
    const stream = flow(async function* () {
      yield 1;
      throw new Error('boom');
    });

    const delayedAtom = pipe(stream, delay(5));

    const results: number[] = [];
    let caught: any;
    try {
      for await (const value of iterate(delayedAtom)) {
        results.push(value);
      }
    } catch (err) {
      caught = err;
    }

    expect(results).toEqual([1]);
    expect(caught?.message).toBe('boom');
  });

  it('clears the pending sleep timer and stops the reader on cancellation', async () => {
    const timeoutSpy = spyOn(globalThis, 'setTimeout').and.callThrough();
    const clearSpy = spyOn(globalThis, 'clearTimeout').and.callThrough();

    let sourceCalls = 0;
    const source: AsyncIterator<number> & AsyncIterable<number> = {
      next: () => {
        sourceCalls += 1;
        if (sourceCalls === 1) {
          return Promise.resolve({ done: false as const, value: 1 });
        }
        // Parked forever: only cancellation may stop the loop.
        return new Promise<IteratorResult<number>>(() => {});
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    const output = delay<number>(5000).apply(source);
    await wait(20);
    expect(timeoutSpy).toHaveBeenCalledWith(jasmine.any(Function), 5000);
    // Select the delay's own 5000 ms timer: other timers (including this
    // test's waits) may interleave in a shared page.
    const sleepHandle = timeoutSpy.calls
      .all()
      .find(call => call.args[1] === 5000)!.returnValue;

    await output.return?.();
    // The pending sleep timer is cleared at teardown instead of staying
    // armed for the full 5000 ms.
    expect(clearSpy).toHaveBeenCalledWith(sleepHandle);

    // The reader never pulls the source again after cancellation.
    const callsAfterCancel = sourceCalls;
    await wait(30);
    expect(sourceCalls).toBe(callsAfterCancel);
  });
});
