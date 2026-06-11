import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { none } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('none', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should emit true when no values satisfy the predicate', async () => {
    const predicate = (value: number) => value > 10;
    const noneStream = source.pipe(none(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of noneStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(9);
    source$.dispose();
    await settle();

    expect(results).toEqual([true]);
  });

  it('should emit false immediately once a value satisfies the predicate', async () => {
    const predicate = (value: number) => value > 5;
    const noneStream = source.pipe(none(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of noneStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(6);
    source$.set(2);
    source$.dispose();
    await settle();

    expect(results).toEqual([false]);
  });

  it('should await asynchronous predicates before deciding', async () => {
    const predicate = async (value: number) => value === 3;
    const noneStream = source.pipe(none(predicate));
    const results: boolean[] = [];

    void (async () => {
      for await (const value of noneStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(3);
    source$.dispose();
    await settle();

    expect(results).toEqual([false]);
  });
});
