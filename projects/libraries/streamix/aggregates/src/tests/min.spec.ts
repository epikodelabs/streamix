import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { min } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('min', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should emit the smallest value', async () => {
    const minStream = source.pipe(min());
    const results: number[] = [];

    void (async () => {
      for await (const value of minStream) {
        results.push(value);
      }
    })();

    source$.set(3);
    source$.set(1); // Smallest value
    source$.set(2);
    source$.dispose();
    await settle();

    expect(results).toEqual([1]);
  });

  it('should propagate errors from the source stream', async () => {
    const minStream = source.pipe(min());
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of minStream) {
          void _;
        }
      } catch (err) {
        error = err;
      }
    })();

    source$.setError(new Error('Test Error'));
    await settle();

    expect(error).toEqual(new Error('Test Error'));
  });
});
