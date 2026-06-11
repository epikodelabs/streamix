import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { sum } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('sum', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should emit the sum of emitted values', async () => {
    const sumStream = source.pipe(sum());
    const results: number[] = [];

    void (async () => {
      for await (const value of sumStream) {
        results.push(value);
      }
    })();

    source$.set(2);
    source$.set(3);
    source$.set(5);
    source$.dispose();
    await settle();

    expect(results).toEqual([10]);
  });

  it('should respect asynchronous selectors', async () => {
    const sumStream = source.pipe(
      sum(async (value, index) => value + index)
    );
    const results: number[] = [];

    void (async () => {
      for await (const value of sumStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.dispose();
    await settle();

    expect(results).toEqual([9]);
  });

  it('should emit 0 if no values were emitted', async () => {
    const sumStream = source.pipe(sum());
    const results: number[] = [];

    void (async () => {
      for await (const value of sumStream) {
        results.push(value);
      }
    })();

    source$.dispose();
    await settle();

    expect(results).toEqual([0]);
  });
});
