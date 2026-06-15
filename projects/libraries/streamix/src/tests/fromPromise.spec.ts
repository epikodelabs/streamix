import {fromPromise, iterate} from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('fromPromise', () => {
  it('should emit value from resolved promise', async () => {
    const value = 'test_value';
    const promise = Promise.resolve(value);
    const atom = fromPromise(promise);

    const emittedValues: string[] = [];
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual([value]);
  });

  it('should emit a single value from a Promise', async () => {
    const promiseValue = 'Hello';
    const promise = Promise.resolve(promiseValue);
    const atom = fromPromise(promise);

    const emittedValues: string[] = [];
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual([promiseValue]);
  });

  it('should propagate an error from a rejected Promise', async () => {
    const expectedError = new Error('Promise rejection');
    const promise = Promise.reject(expectedError);
    void promise.catch(() => {});
    const atom = fromPromise(promise);

    let caught: any;
    try {
      for await (const v of iterate(atom)) {
        fail(`Value emitted unexpectedly: ${v}`);
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(expectedError);
  });

  it('should propagate an error from a Promise rejected after a small delay', async () => {
    const expectedError = new Error('Delayed promise rejection');
    const promise = new Promise((_, reject) => {
      setTimeout(() => reject(expectedError), 10);
    });
    const atom = fromPromise(promise);

    let caught: any;
    try {
      for await (const v of iterate(atom)) {
        fail(`Value emitted unexpectedly: ${v}`);
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(expectedError);
  });

  it('should not emit if unsubscribed before run', async () => {
    const value = 'test_value';
    const promise = new Promise<string>((resolve) => setTimeout(() => resolve(value), 20));
    const atom = fromPromise(promise);

    const emittedValues: string[] = [];
    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    subscription.unsubscribe();

    await delay(40);
    expect(emittedValues).toEqual([]);
  });

  it('should abort an abortable promise factory when unsubscribed', async () => {
    let capturedSignal: AbortSignal | undefined;
    const emittedValues: string[] = [];

    const atom = fromPromise<string>(((signal: AbortSignal) => {
      capturedSignal = signal;

      return new Promise<string>((resolve, reject) => {
        const timeoutId = setTimeout(() => resolve('late_value'), 50);

        signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error('Aborted'));
        }, { once: true });
      });
    }) as any);

    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    await subscription.unsubscribe();

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
    expect(emittedValues).toEqual([]);
  });

  it('should invoke factory when the atom is subscribed', async () => {
    let callCount = 0;
    const factory = () => {
      callCount++;
      return Promise.resolve('result');
    };
    const atom = fromPromise(factory);

    expect(callCount).toBe(0);

    const values: string[] = [];
    atom.subscribe(v => { if (v !== undefined) values.push(v); });
    await delay();

    expect(callCount).toBe(1);
    expect(values).toEqual(['result']);
  });

  it('should emit error when factory throws immediately', async () => {
    const error = new Error('sync failure');
    const atom = fromPromise(() => {
      throw error;
    });

    let caught: any;
    try {
      for await (const v of iterate(atom)) {
        fail(`Value emitted unexpectedly: ${v}`);
      }
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(error);
  });

  it('should emit synchronous value without promise', async () => {
    const atom = fromPromise(123);
    const values: number[] = [];

    atom.subscribe(v => { if (v !== undefined) values.push(v); });
    await delay();

    expect(values).toEqual([123]);
  });

  it('should emit sync factory result without promise', async () => {
    const atom = fromPromise(() => 'sync-factory');
    const values: string[] = [];

    atom.subscribe(v => { if (v !== undefined) values.push(v); });
    await delay();

    expect(values).toEqual(['sync-factory']);
  });
});
