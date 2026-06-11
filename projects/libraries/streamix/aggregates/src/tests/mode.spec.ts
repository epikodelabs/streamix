import { atom, fromAtom, type Atom, type Stream } from '@epikodelabs/streamix';
import { mode } from '@epikodelabs/streamix/aggregates';

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('mode', () => {
  let source$: Atom<number>;
  let source: Stream<number>;

  beforeEach(() => {
    source$ = atom<number>();
    source = fromAtom(source$);
  });

  it('should emit the most frequently occurring value', async () => {
    const modeStream = source.pipe(mode());
    const results: number[][] = [];

    void (async () => {
      for await (const value of modeStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(2);
    source$.set(3);
    source$.dispose();
    await settle();

    expect(results).toEqual([[2]]);
  });

  it('should emit all values that share the top frequency', async () => {
    const modeStream = source.pipe(mode());
    const results: number[][] = [];

    void (async () => {
      for await (const value of modeStream) {
        results.push(value);
      }
    })();

    source$.set(1);
    source$.set(2);
    source$.set(1);
    source$.set(2);
    source$.dispose();
    await settle();

    expect(results).toEqual([[1, 2]]);
  });

  it('should be able to key values before counting', async () => {
    const itemSource$ = atom<{ group: string; value: string }>();
    const itemSource: Stream<{ group: string; value: string }> = fromAtom(itemSource$);
    const modeStream = itemSource.pipe(mode((item) => item.group));
    const results: { group: string; value: string }[][] = [];

    void (async () => {
      for await (const value of modeStream) {
        results.push(value);
      }
    })();

    itemSource$.set({ group: 'alpha', value: 'a' });
    itemSource$.set({ group: 'beta', value: 'b' });
    itemSource$.set({ group: 'alpha', value: 'a2' });
    itemSource$.set({ group: 'beta', value: 'b2' });
    itemSource$.dispose();
    await settle();

    expect(results).toEqual([
      [
        { group: 'alpha', value: 'a' },
        { group: 'beta', value: 'b' },
      ],
    ]);
  });

  it('should not emit when the stream is empty', async () => {
    const modeStream = source.pipe(mode());
    const results: number[][] = [];

    void (async () => {
      for await (const value of modeStream) {
        results.push(value);
      }
    })();

    source$.dispose();
    await settle();

    expect(results).toEqual([]);
  });
});
