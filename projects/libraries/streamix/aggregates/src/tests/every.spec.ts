import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { every } from '@epikodelabs/streamix/aggregates';

describe('every', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should emit true if all values satisfy the predicate', async () => {
    const predicate = (value: number) => value > 0;
    const everyStream = source.pipe(every(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of everyStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3); // All values > 0
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([true]);
  });

  it('should emit false if any value does not satisfy the predicate', async () => {
    const predicate = (value: number) => value > 0;
    const everyStream = source.pipe(every(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of everyStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(-1); // Does not satisfy predicate (value > 0)
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([false]);
  });

  it('should emit true if the stream is empty', async () => {
    const predicate = (value: number) => value > 0;
    const everyStream = source.pipe(every(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of everyStream) {
        results.push(value);
      }
    })();

    source$.dispose(); // Empty stream, so it should emit true
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([true]);
  });

  it('should propagate errors from the source stream', async () => {
    const predicate = (value: number) => value > 0;
    const everyStream = source.pipe(every(predicate));
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of everyStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    source$.setError(new Error('Test Error'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(error).toEqual(new Error('Test Error')); // Propagate error
  });

  it('should complete after emitting true when all values satisfy the predicate', async () => {
    const predicate = (value: number) => value > 0;
    const everyStream = source.pipe(every(predicate));
    let completed = false;

    void (async () => {
      for await (const _ of everyStream) {
        void _;
        completed = true;
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.dispose(); // All values > 0, should emit true and complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(completed).toBe(true);
  });

  it('should complete after emitting false if any value does not satisfy the predicate', async () => {
    const predicate = (value: number) => value > 0;
    const everyStream = source.pipe(every(predicate));
    let completed = false;

    void (async () => {
      for await (const _ of everyStream) {
        void _;
        completed = true;
      }
    })();

    source$.set(1);
    source$.set(-1); // Does not satisfy predicate, should emit false and complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(completed).toBe(true);
  });
});
