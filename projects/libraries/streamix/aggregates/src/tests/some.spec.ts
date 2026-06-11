import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { some } from '@epikodelabs/streamix/aggregates';

describe('some', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should emit true if any value matches the predicate', async () => {
    const predicate = (value: number) => value > 2;
    const someStream = source.pipe(some(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of someStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3); // Satisfies predicate (value > 2)
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([true]);
  });

  it('should emit false if no value matches the predicate', async () => {
    const predicate = (value: number) => value > 5;
    const someStream = source.pipe(some(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of someStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.dispose(); // No value satisfies predicate (value > 5)
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([false]);
  });

  it('should emit false if the stream is empty', async () => {
    const predicate = (value: number) => value > 2;
    const someStream = source.pipe(some(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of someStream) {
        results.push(value);
      }
    })();

    source$.dispose(); // No values, so should emit false
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([false]);
  });

  it('should propagate errors from the source stream', async () => {
    const predicate = (value: number) => value > 2;
    const someStream = source.pipe(some(predicate));
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of someStream) {}
      } catch (err) {
        error = err;
      }
    })();

    source$.setError(new Error('Test Error'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(error).toEqual(new Error('Test Error')); // Propagate error
  });

  it('should complete after emitting true when predicate is matched', async () => {
    const predicate = (value: number) => value > 2;
    const someStream = source.pipe(some(predicate));
    let completed = false;

    void (async () => {
      for await (const _ of someStream) {
        completed = true;
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3); // Satisfies predicate, should emit true and complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(completed).toBe(true);
  });

  it('should complete after emitting false if no value matches the predicate', async () => {
    const predicate = (value: number) => value > 5;
    const someStream = source.pipe(some(predicate));
    let completed = false;

    void (async () => {
      for await (const _ of someStream) {
        completed = true;
      }
    })();

    source$.set(1);
    source$.set(2); // No value satisfies predicate, should emit false and complete
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(completed).toBe(true);
  });
});
