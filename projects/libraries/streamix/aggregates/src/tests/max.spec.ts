import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { max } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('max', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should emit the largest value', async () => {
    const maxStream = source.pipe(max());
    const results: number[] = [];

    void (async () => {
      for await (const value of maxStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(3); // Largest value
    source$.set(2);
    source$.dispose();
    await settle();

    expect(results).toEqual([3]);
  });

  it('should propagate errors from the source stream', async () => {
    const maxStream = source.pipe(max());
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of maxStream) {
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
