import {
  atom,
  fromAtom,
  type Stream,
  type Atom,
  toArray,
} from '@epikodelabs/streamix';

describe('toArray', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should collect all values and emit them as an array when the stream completes', async () => {
    const toArrayStream = source.pipe(toArray());
    const results: number[][] = [];

    void (async () => {
      for await (const value of toArrayStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([[1, 2, 3]]);
  });

  it('should emit an empty array when the stream completes without emitting any values', async () => {
    const toArrayStream = source.pipe(toArray());
    const results: number[][] = [];

    void (async () => {
      for await (const value of toArrayStream) {
        results.push(value);
      }
    })();

    source$.dispose(); // No values emitted, just completing
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([[]]); // Empty array
  });

  it('should propagate errors from the source stream', async () => {
    const toArrayStream = source.pipe(toArray());
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of toArrayStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    source$.setError(new Error('Test Error'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(error).toEqual(new Error('Test Error'));  // Propagate error
  });

  it('should handle the stream completing after emitting values', async () => {
    const toArrayStream = source.pipe(toArray());
    const results: number[][] = [];

    void (async () => {
      for await (const value of toArrayStream) {
        results.push(value);
      }
    })();

    source$.set(10);
    source$.set(20);
    source$.set(30);
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([[10, 20, 30]]);
  });

  it('should handle an edge case where only one value is emitted', async () => {
    const toArrayStream = source.pipe(toArray());
    const results: number[][] = [];

    void (async () => {
      for await (const value of toArrayStream) {
        results.push(value);
      }
    })();

    source$.set(42); // Single value
    source$.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(results).toEqual([[42]]);  // Single value in array
  });

});
