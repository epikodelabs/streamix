import { createStream, delay, from } from '@epikodelabs/streamix';

describe('delay', () => {
  it('should delay each value by the specified time', (done) => {
    const testStream = from([1, 2, 3]);
    const delayTime = 100; // 100 ms delay

    const delayedStream = testStream.pipe(delay(delayTime));

    const startTime = Date.now();
    let emitCount = 0;

    delayedStream.subscribe({
      next: () => {
        emitCount++;
        const elapsedTime = Date.now() - startTime + 5;
        expect(elapsedTime).toBeGreaterThanOrEqual(emitCount * delayTime);
      },
      complete: () => {
        expect(emitCount).toBe(3);
        done();
      }
    });
  });

  it('should stop emitting if the stream is cancelled', (done) => {
    const testStream = from([1, 2, 3]);
    const delayTime = 1000; // 100 ms delay

    const delayedStream = testStream.pipe(delay(delayTime));

    let emitCount = 0;

    let subscription = delayedStream.subscribe({
      next: () => {
        emitCount++;
        if (emitCount === 2) {
          subscription.unsubscribe();
        }
      },
      complete: () => {
        expect(emitCount).toBe(2);
        done();
      }
    });
  });

  it('should emit all values with delay before stopping', (done) => {
    const testStream = from([1, 2, 3, 4, 5]);
    const delayTime = 100; // 100 ms delay

    let emitCount = 0;

    const delayedStream = testStream.pipe(delay(delayTime));

    delayedStream.subscribe({
      next: () => emitCount++,
      complete: () => {
        expect(emitCount).toBe(5);
        done();
      }
    });
  });

  it('should respect promise-based delay inputs', (done) => {
    const testStream = from([1]);
    const delayPromise = Promise.resolve(10);

    const delayedStream = testStream.pipe(delay(delayPromise));
    const startTime = Date.now();

    delayedStream.subscribe({
      next: (value) => {
        expect(value).toBe(1);
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeGreaterThanOrEqual(9);
      },
      complete: () => done(),
      error: done.fail,
    });
  });

  it('should treat undefined delay durations as immediate', (done) => {
    const testStream = from([42]);
    const delayPromise = Promise.resolve<number | undefined>(undefined);

    const delayedStream = testStream.pipe(delay(delayPromise as any));
    const startTime = Date.now();

    delayedStream.subscribe({
      next: (value) => {
        expect(value).toBe(42);
        expect(Date.now() - startTime).toBeLessThan(10);
      },
      complete: () => done(),
      error: done.fail,
    });
  });

  it('should forward source errors through the delay operator', (done) => {
    const stream = createStream('error-source', async function* () {
      yield 1;
      throw new Error('boom');
    });

    const delayedStream = stream.pipe(delay(5));

    delayedStream.subscribe({
      next: () => {},
      error: (err: any) => {
        expect(err.message).toBe('boom');
        done();
      },
      complete: () => done.fail('should error before completing'),
    });
  });
});


