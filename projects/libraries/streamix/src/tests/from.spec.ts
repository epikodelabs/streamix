import { from } from '@epikodelabs/streamix';

describe('from', () => {

  it('should emit values in sequence and complete (Array)', async () => {
    const values = [1, 2, 3];
    const stream = from(values);
    let emittedValues: any[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual(values);
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: reject
      });
    });
  });

  it('should emit values from an iterable (Generator)', async () => {
    function* numberGenerator() {
      yield 10;
      yield 20;
      yield 30;
    }
    const stream = from(numberGenerator());
    let emittedValues: number[] = [];
    const expected = [10, 20, 30];

    await new Promise<void>((resolve, reject) => {
      stream.subscribe({
        next: (value) => emittedValues.push(value),
        complete: () => {
          try {
            expect(emittedValues).toEqual(expected);
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        error: reject
      });
    });
  });

  it('should stop emitting values when unsubscribe is called early', async () => {
    // Async generator
    async function* asyncNumberGenerator() {
      yield 1;
      await new Promise(r => setTimeout(r, 10));
      yield 2;
      await new Promise(r => setTimeout(r, 10));
      yield 3;
    }

    const stream = from(asyncNumberGenerator());
    const emittedValues: number[] = [];

    await new Promise<void>((resolve, reject) => {
      const subscription = stream.subscribe({
        next: (value) => {
          emittedValues.push(value);
          if (value === 1) {
            // Unsubscribe immediately after first value
            subscription.unsubscribe();

            // Delay a bit to catch any stray emissions
            setTimeout(() => {
              try {
                expect(emittedValues).toEqual([1]); // only first value
                resolve();
              } catch (e) {
                reject(e);
              }
            }, 50);
          }
        },
        error: reject,
        complete: () => {
          // We allow complete() to fire; do not fail the test
        }
      });
    });
  });

  it('should await promised iterables before emitting', async () => {
    const promiseSource = Promise.resolve([4, 5, 6]);
    const stream = from(promiseSource);
    const collected: number[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.subscribe({
        next: (value) => collected.push(value),
        complete: () => {
          try {
            expect(collected).toEqual([4, 5, 6]);
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        error: reject,
      });
    });
  });

  it('pulls async iterables lazily', async () => {
    let pulls = 0;

    async function* source() {
      pulls++;
      yield 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      pulls++;
      yield 2;
    }

    const iterator = from(source())[Symbol.asyncIterator]();

    expect(pulls).toBe(0);
    expect(await iterator.next()).toEqual({ done: false, value: 1 });
    expect(pulls).toBe(1);

    await iterator.return?.();
  });

  it('closes an input while its read is stalled', async () => {
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const close = jasmine.createSpy('return').and.resolveTo({ done: true, value: undefined });
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: () => { started(); return new Promise(() => {}); },
        return: close,
      }),
    };
    const iterator = from(source)[Symbol.asyncIterator]();
    const read = iterator.next();
    await reading;
    await iterator.return?.();
    expect((await read).done).toBeTrue();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('unwraps promised items on the pull path', async () => {
    const iterator = from([Promise.resolve(3)])[Symbol.asyncIterator]();
    const result = await iterator.next();
    expect(result.value as unknown).toBe(3);
    await iterator.return?.();
  });

  it('closes a stalled input when the last subscriber unsubscribes', async () => {
    let start!: () => void;
    let close!: () => void;
    const reading = new Promise<void>(resolve => { start = resolve; });
    const closed = new Promise<void>(resolve => { close = resolve; });
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: () => { start(); return new Promise(() => {}); },
        return: async () => { close(); return { done: true, value: undefined }; },
      }),
    };
    const subscription = from(source).subscribe();
    await reading;
    await subscription.unsubscribe();
    await closed;
  });
});

