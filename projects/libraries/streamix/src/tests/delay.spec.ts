import { createStream, delay, from, iterate, pipe, atom } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('delay', () => {
  it('should delay each value by the specified time', async () => {
    const testStream = from([1, 2, 3]);
    const delayTime = 100;

    const delayedAtom = pipe(testStream, delay(delayTime));

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
    const testStream = from([1, 2, 3]);
    const delayTime = 1000;

    const delayedAtom = pipe(testStream, delay(delayTime));

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
    const testStream = from([1, 2, 3, 4, 5]);
    const delayTime = 100;

    const delayedAtom = pipe(testStream, delay(delayTime));
    const results: number[] = [];
    for await (const value of iterate(delayedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it('should respect promise-based delay inputs', async () => {
    const testStream = from([1]);
    const delayPromise = Promise.resolve(10);

    const delayedAtom = pipe(testStream, delay(delayPromise));
    const startTime = Date.now();

    const results: number[] = [];
    for await (const value of iterate(delayedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([1]);
    expect(Date.now() - startTime).toBeGreaterThanOrEqual(9);
  });

  it('should treat undefined delay durations as immediate', async () => {
    const testStream = from([42]);
    const delayPromise = Promise.resolve<number | undefined>(undefined);

    const delayedAtom = pipe(testStream, delay(delayPromise as any));
    const startTime = Date.now();

    const results: number[] = [];
    for await (const value of iterate(delayedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([42]);
    expect(Date.now() - startTime).toBeLessThan(10);
  });

  it('should forward source errors through the delay operator', async () => {
    const stream = createStream('error-source', async function* () {
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
});
