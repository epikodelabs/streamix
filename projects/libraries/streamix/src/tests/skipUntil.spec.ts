import { createBehaviorSubject, createSubject, from, skipUntil } from '@epikodelabs/streamix';

const flushMicrotasks = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('skipUntil', () => {
  it('should skip values before notifier emits and emit after that (Immediate Notifier)', async () => {
    const emissions = [1, 2, 3, 4, 5];
    const source$ = createSubject<number>();
    const notifier$ = createBehaviorSubject(true);
    const result: number[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      source$.pipe(skipUntil(notifier$)).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    await flushMicrotasks();
    emissions.forEach((val) => source$.next(val));
    source$.complete();

    await promise;
    await flushMicrotasks();
    expect(result).toEqual(emissions);
  });

  it('should skip values until notifier emits (Immediate `from` Notifier)', async () => {
    const source$ = createSubject<number>();
    const notifier$ = from([true]);
    const result: number[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      source$.pipe(skipUntil(notifier$)).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    await flushMicrotasks();
    [1, 2, 3, 4, 5].forEach((val) => source$.next(val));
    source$.complete();

    await promise;
    await flushMicrotasks();
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should skip all values if notifier never emits', async () => {
    const source$ = from([1, 2, 3]);
    const notifier$ = createSubject();
    const result: number[] = [];

    await new Promise<void>((resolve, reject) => {
      source$.pipe(skipUntil(notifier$)).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    await flushMicrotasks();
    expect(result).toEqual([]);
  });
  
  it('should skip initial values and then emit the rest after notifier delay', async () => {
    const source$ = createSubject<number>();
    const notifier$ = createSubject<boolean>();
    const result: number[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      source$.pipe(skipUntil(notifier$)).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    source$.next(1);
    source$.next(2);
    source$.next(3);
    notifier$.next(true);
    await flushMicrotasks();
    source$.next(4);
    source$.next(5);
    source$.complete();
    notifier$.complete();

    await promise;
    await flushMicrotasks();
    expect(result).toEqual([4, 5]);
  });

  it('should stop skipping when notifier completes without emitting (should continue skipping)', async () => {
    const source$ = createSubject<number>();
    const notifier$ = createSubject<boolean>();
    const result: number[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      source$.pipe(skipUntil(notifier$)).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    source$.next(1);
    source$.next(2);
    notifier$.complete();
    source$.next(3);
    source$.next(4);
    source$.complete();

    await promise;
    await flushMicrotasks();
    expect(result).toEqual([]);
  });

  it('should propagate an error from the source stream immediately', async () => {
    const source$ = createSubject<number>();
    const notifier$ = createSubject<boolean>();
    const expectedError = new Error('Source failed');
    let receivedError: unknown = null;

    const promise = new Promise<void>((resolve, reject) => {
      source$.pipe(skipUntil(notifier$)).subscribe({
        next: () => reject(new Error('Value was incorrectly emitted')),
        complete: () => reject(new Error('Stream completed unexpectedly')),
        error: (err) => {
          receivedError = err;
          resolve();
        }
      });
    });

    source$.next(1);
    source$.error(expectedError);
    notifier$.next(true);

    await promise;
    await flushMicrotasks();
    expect(receivedError).toBe(expectedError);
  });

  it('should propagate an error from the notifier stream immediately', async () => {
    const source$ = createSubject<number>();
    const notifier$ = createSubject<boolean>();
    const expectedError = new Error('Notifier failed');
    let receivedError: unknown = null;

    const promise = new Promise<void>((resolve, reject) => {
      source$.pipe(skipUntil(notifier$)).subscribe({
        next: () => reject(new Error('Value was incorrectly emitted')),
        complete: () => reject(new Error('Stream completed unexpectedly')),
        error: (err) => {
          receivedError = err;
          resolve();
        }
      });
    });

    source$.next(1);
    notifier$.error(expectedError);
    source$.next(2);
    source$.complete();

    await promise;
    await flushMicrotasks();
    expect(receivedError).toBe(expectedError);
  });
});
