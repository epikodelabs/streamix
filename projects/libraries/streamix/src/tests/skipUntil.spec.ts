import { atom, fromAtom, from, skipUntil } from '@epikodelabs/streamix';

const flushMicrotasks = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('skipUntil', () => {
  it('should skip values before notifier emits and emit after that (Immediate Notifier)', async () => {
    const emissions = [1, 2, 3, 4, 5];
    const source$ = atom<number>();
    const notifier$ = atom(true);
    const result: number[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      fromAtom(source$).pipe(skipUntil(fromAtom(notifier$))).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    await flushMicrotasks();
    emissions.forEach((val) => source$.set(val));
    source$.dispose();

    await promise;
    await flushMicrotasks();
    expect(result).toEqual(emissions);
  });

  it('should skip values until notifier emits (Immediate `from` Notifier)', async () => {
    const source$ = atom<number>();
    const notifier$ = from([true]);
    const result: number[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      fromAtom(source$).pipe(skipUntil(notifier$)).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    await flushMicrotasks();
    [1, 2, 3, 4, 5].forEach((val) => source$.set(val));
    source$.dispose();

    await promise;
    await flushMicrotasks();
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should skip all values if notifier never emits', async () => {
    const source$ = from([1, 2, 3]);
    const notifier$ = atom();
    const result: number[] = [];

    await new Promise<void>((resolve, reject) => {
      source$.pipe(skipUntil(fromAtom(notifier$))).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    await flushMicrotasks();
    expect(result).toEqual([]);
  });

  it('should skip initial values and then emit the rest after notifier delay', async () => {
    const source$ = atom<number>();
    const notifier$ = atom<boolean>();
    const result: number[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      fromAtom(source$).pipe(skipUntil(fromAtom(notifier$))).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    source$.set(1);
    source$.set(2);
    source$.set(3);
    notifier$.set(true);
    await flushMicrotasks();
    source$.set(4);
    source$.set(5);
    source$.dispose();
    notifier$.dispose();

    await promise;
    await flushMicrotasks();
    expect(result).toEqual([4, 5]);
  });

  it('should stop skipping when notifier completes without emitting (should continue skipping)', async () => {
    const source$ = atom<number>();
    const notifier$ = atom<boolean>();
    const result: number[] = [];

    const promise = new Promise<void>((resolve, reject) => {
      fromAtom(source$).pipe(skipUntil(fromAtom(notifier$))).subscribe({
        next: val => result.push(val),
        complete: resolve,
        error: reject
      });
    });

    source$.set(1);
    source$.set(2);
    notifier$.dispose();
    source$.set(3);
    source$.set(4);
    source$.dispose();

    await promise;
    await flushMicrotasks();
    expect(result).toEqual([]);
  });

  it('should propagate an error from the source stream immediately', async () => {
    const source$ = atom<number>();
    const notifier$ = atom<boolean>();
    const expectedError = new Error('Source failed');
    let receivedError: unknown = null;

    const promise = new Promise<void>((resolve, reject) => {
      fromAtom(source$).pipe(skipUntil(fromAtom(notifier$))).subscribe({
        next: () => reject(new Error('Value was incorrectly emitted')),
        complete: () => reject(new Error('Stream completed unexpectedly')),
        error: (err) => {
          receivedError = err;
          resolve();
        }
      });
    });

    source$.set(1);
    source$.setError(expectedError);
    notifier$.set(true);

    await promise;
    await flushMicrotasks();
    expect(receivedError).toBe(expectedError);
  });

  it('should propagate an error from the notifier stream immediately', async () => {
    const source$ = atom<number>();
    const notifier$ = atom<boolean>();
    const expectedError = new Error('Notifier failed');
    let receivedError: unknown = null;

    const promise = new Promise<void>((resolve, reject) => {
      fromAtom(source$).pipe(skipUntil(fromAtom(notifier$))).subscribe({
        next: () => reject(new Error('Value was incorrectly emitted')),
        complete: () => reject(new Error('Stream completed unexpectedly')),
        error: (err) => {
          receivedError = err;
          resolve();
        }
      });
    });

    source$.set(1);
    notifier$.setError(expectedError);
    source$.set(2);
    source$.dispose();

    await promise;
    await flushMicrotasks();
    expect(receivedError).toBe(expectedError);
  });
});
