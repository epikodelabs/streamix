import { combineLatest, from, type Subscription, timer } from '@epikodelabs/streamix';

describe('combineLatest', () => {
  it('should combine timer streams correctly', (done) => {
    const firstTimer = timer(0, 50);
    const secondTimer = timer(25, 50);

    const combinedTimers = combineLatest(firstTimer, secondTimer);
    const expectedValues = [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ];

    let index = 0;

    let subscription = combinedTimers.subscribe({
      next: (latestValues: any) => {
        try {
          expect(latestValues).toEqual(expectedValues[index]);
          index++;

          if (index === expectedValues.length) {
            subscription.unsubscribe();
            done();
          }
        } catch (error) {
          subscription.unsubscribe();
          fail(error);
        }
      },
      error: (error) => {
        subscription.unsubscribe();
        fail(error);
      },
    });
  });

  it('should stop emitting values after cancellation', (done) => {
    const firstTimer = timer(0, 50);
    const secondTimer = timer(25, 50);

    const combinedTimers = combineLatest(firstTimer, secondTimer);
    let emissionCount = 0;

    const subscription: Subscription = combinedTimers.subscribe({
      next: () => {
        emissionCount++;
        subscription.unsubscribe();
        expect(emissionCount).toBe(1);
        expect(subscription.unsubscribed).toBe(true);
        done();
      },
      complete: () => {},
    });
  });

  it('should handle completion of one stream', (done) => {
    const firstTimer = timer(0, 50);
    const secondTimer = timer(25, 50);

    const combinedTimers = combineLatest(firstTimer, secondTimer);
    const expectedValues = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];

    let index = 0;

    const subscription = combinedTimers.subscribe({
      next: (latestValues: any) => {
        try {
          expect(latestValues).toEqual(expectedValues[index]);
          index++;

          if (index === expectedValues.length) {
            subscription.unsubscribe();
            done();
          }
        } catch (error) {
          fail(error);
        }
      },
      error: (error) => {
        subscription.unsubscribe();
        fail(error);
      },
    });
  });

  it('should combine multiple streams correctly', (done) => {
    const firstTimer = timer(0, 500);
    const secondTimer = timer(250, 500);
    const thirdTimer = timer(100, 500);

    const combinedTimers = combineLatest(firstTimer, secondTimer, thirdTimer);
    const expectedValues = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 1],
      [2, 1, 1],
      [2, 1, 2],
    ];

    let index = 0;

    const subscription = combinedTimers.subscribe({
      next: (latestValues: any) => {
        try {
          expect(latestValues).toEqual(expectedValues[index]);
          index++;

          if (index === expectedValues.length) {
            subscription.unsubscribe();
            done();
          }
        } catch (error) {
          subscription.unsubscribe();
          fail(error);
        }
      },
      error: (error) => {
        subscription.unsubscribe();
        fail(error);
      },
    });
  });

  it('should combine from streams and complete after the third emission', (done) => {
    const firstStream = from([0, 1, 2]);
    const secondStream = from([0, 1, 2]);
    const combinedStream = combineLatest(firstStream, secondStream);
    let nextCalled = false;

    const subscription = combinedStream.subscribe({
      next: () => (nextCalled = true),
      complete: () => {
        subscription.unsubscribe();
        expect(nextCalled).toBe(true);
        done();
      },
    });
  });

  it('should resolve promise-based inputs before emitting', (done) => {
    const combinedStream = combineLatest(Promise.resolve(1), Promise.resolve(2));
    const emitted: number[][] = [];

    combinedStream.subscribe({
      next: (value) => emitted.push(value as number[]),
      complete: () => {
        expect(emitted).toEqual([[1, 2]]);
        done();
      },
      error: (error) => done.fail(error),
    });
  });

  it('should complete immediately with no sources', (done) => {
    const combinedStream = combineLatest();
    const timeout = setTimeout(() => done.fail('did not complete'), 50);

    combinedStream.subscribe({
      next: () => done.fail('should not emit'),
      complete: () => {
        clearTimeout(timeout);
        done();
      },
      error: (error) => done.fail(error),
    });
  });
});


