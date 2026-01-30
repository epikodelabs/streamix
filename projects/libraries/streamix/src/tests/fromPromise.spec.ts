import { fromPromise } from '@epikodelabs/streamix';

describe('fromPromise', () => {
  it('should emit value from resolved promise', (done) => {
    const value = 'test_value';
    const promise = Promise.resolve(value);
    const stream = fromPromise(promise);

    const emittedValues: any[] = [];
    stream.subscribe({
      next: (value: any) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([value]);
        done();
      }
    })
  });

  it('should emit a single value from a Promise and then complete', async () => {
    const promiseValue = 'Hello';
    const promise = Promise.resolve(promiseValue);
    const stream = fromPromise(promise);
    let emittedValues: any[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual([promiseValue]);
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: reject
      });
    });
  });

  it('should propagate an error from a rejected Promise', async () => {
    const expectedError = new Error('Promise rejection');
    const promise = Promise.reject(expectedError);
    // Prevent Node's unhandledRejection warning before fromPromise subscribes.
    void promise.catch(() => {});
    const stream = fromPromise(promise);

    // We expect the promise to be rejected, so we use async/await with try/catch
    try {
      await new Promise<void>((resolve, reject) => {
        stream.subscribe({
          next: () => reject(new Error('Value emitted unexpectedly')),
          complete: () => reject(new Error('Stream completed unexpectedly')),
          error: (err) => {
            expect(err).toBe(expectedError);
            resolve(); // Resolve on expected error
          }
        });
      });
    } catch (e) {
      // If the promise rejects for any reason other than the expected error, fail
      fail(`Test failed in unexpected way: ${e}`);
    }
  });

  it('should propagate an error from a Promise rejected after a small delay', (done) => {
    const expectedError = new Error('Delayed promise rejection');
    const promise = new Promise((_, reject) => {
      setTimeout(() => reject(expectedError), 10);
    });
    const stream = fromPromise(promise);

    stream.subscribe({
      next: () => fail('Value emitted unexpectedly'),
      complete: () => done.fail('Stream completed unexpectedly'),
      error: (err) => {
        expect(err).toBe(expectedError);
        done();
      }
    });
  });
  it('should complete after emitting value', (done) => {
    const value = 'test_value';
    const promise = Promise.resolve(value);
    const stream = fromPromise(promise);

    let completed = false;
    stream.subscribe({
      next: () => completed = true,
      complete: () => {
        expect(completed).toBe(true);
        done();
      }
    });
  });

  it('should handle promise rejection', (done) => {
    const error = new Error('Test error');
    const promise = Promise.reject(error);
    // Prevent Node's unhandledRejection warning before fromPromise subscribes.
    void promise.catch(() => {});
    const stream = fromPromise(promise);

    let receivedError: Error | undefined;
    const subscription = stream.subscribe({
      error: (error: any) => {
        receivedError = error;
        expect(receivedError).toBe(error);
        subscription.unsubscribe();
        done();
      },
      complete: () => {
        done.fail('Stream completed unexpectedly');
      }
    });
  });

  it('should not emit if unsubscribed before run', (done) => {
    const value = 'test_value';
    const promise = new Promise<string>((resolve) => setTimeout(() => resolve(value), 20));
    const stream = fromPromise(promise);

    const emittedValues: any[] = [];
    const subscription = stream.subscribe({
      next: (value: any) => emittedValues.push(value),
      error: (err) => done.fail(err),
      complete: () => {}
    });

    // Unsubscribe immediately; do not rely on `complete` being delivered.
    Promise.resolve(subscription.unsubscribe()).then(() => {
      setTimeout(() => {
        expect(emittedValues).toEqual([]);
        done();
      }, 40);
    });
  });

  it('should abort an abortable promise factory when unsubscribed', async () => {
    let capturedSignal: AbortSignal | undefined;
    const emittedValues: any[] = [];

    const stream = fromPromise<string>((signal: AbortSignal) => {
      capturedSignal = signal;

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => resolve('late_value'), 50);

        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error('Aborted'));
        }, { once: true });
      });
    });

    const subscription = stream.subscribe({
      next: (value: any) => emittedValues.push(value),
      error: () => fail('Error emitted unexpectedly'),
      complete: () => {}
    });

    await subscription.unsubscribe();

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
    expect(emittedValues).toEqual([]);
  });

  it('should invoke factory for each subscription', async () => {
    let callCount = 0;
    const factory = () => {
      callCount++;
      return Promise.resolve('result');
    };
    const stream = fromPromise(factory);

    const it1 = stream[Symbol.asyncIterator]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await it1.next()).toEqual({ done: false, value: 'result' });
    await it1.return?.();
    expect(callCount).toBe(1);

    const it2 = stream[Symbol.asyncIterator]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await it2.next()).toEqual({ done: false, value: 'result' });
    await it2.return?.();
    expect(callCount).toBe(2);
  });

  it('should emit error when factory throws immediately', async () => {
    const error = new Error('sync failure');
    const stream = fromPromise(() => {
      throw error;
    });

    await expectAsync(
      new Promise<void>((resolve, reject) => {
        stream.subscribe({
          next: () => reject(new Error('Should not emit')),
          error: (err) => {
            try {
              expect(err).toBe(error);
              resolve();
            } catch (inner) {
              reject(inner);
            }
          },
          complete: () => reject(new Error('Should not complete'))
        });
      })
    ).toBeResolved();
  });

  it('should emit synchronous value without promise', async () => {
    const stream = fromPromise(123);
    const values: number[] = [];

    (async () => {
      for await (const value of stream) {
        values.push(value as number);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(values).toEqual([123]);
  });

  it('should emit sync factory result without promise', async () => {
    const stream = fromPromise(() => 'sync-factory');
    const values: string[] = [];

    (async () => {
      for await (const value of stream) {
        values.push(value as string);
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(values).toEqual(['sync-factory']);
  });
});


