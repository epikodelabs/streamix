import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { count } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('count', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should emit the count of values', async () => {
    const countStream = source.pipe(count());
    const results: number[] = [];

    void (async () => {
      for await (const value of countStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.dispose();
    await settle();

    expect(results).toEqual([3]);
  });

  it('should emit 0 for an empty stream', async () => {
    const countStream = source.pipe(count());
    const results: number[] = [];

    void (async () => {
      for await (const value of countStream) {
        results.push(value);
      }
    })();

    source$.dispose();
    await settle();

    expect(results).toEqual([0]);
  });

  it('should propagate errors from the source stream', async () => {
    const countStream = source.pipe(count());
    let error: any = null;

    void (async () => {
      try {
        for await (const _ of countStream) {
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
