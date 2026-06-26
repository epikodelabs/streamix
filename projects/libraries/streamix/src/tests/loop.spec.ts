import { iterate, loop, type Atom } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

async function collect<T>(atom: Atom<T | undefined>): Promise<T[]> {
  const result: T[] = [];
  for await (const v of iterate(atom)) {
    if (v !== undefined) result.push(v);
  }
  return result;
}

describe('loop', () => {
  it('should emit a sequence of values while the condition is true', async () => {
    const result = await collect<number>(loop(0, x => x < 5, x => x + 1));
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it('should emit nothing if condition is false initially', async () => {
    const result = await collect<number>(loop(10, x => x < 5, x => x + 1));
    expect(result).toEqual([]);
  });

  it('should stop emitting after unsubscribe', async () => {
    const atom = loop(0, x => x < 10, x => x + 1);
    const emitted: number[] = [];

    const sub = atom.subscribe(v => {
      if (v !== undefined) emitted.push(v);
      if (v === 3) {
        sub();
      }
    });

    await delay(50);

    expect(emitted).toEqual([0, 1, 2, 3]);
  });

  it('should work with async for-await-of iteration', async () => {
    const atom = loop(1, x => x <= 3, x => x * 2);
    const values: number[] = [];

    for await (const v of iterate(atom)) {
      if (v !== undefined) values.push(v);
      if (v === 2) break;
    }

    expect(values).toEqual([1, 2]);
  });

  it('should allow multiple subscriptions with independent state', async () => {
    const s1 = loop(0, x => x < 3, x => x + 1);
    const s2 = loop(10, x => x < 13, x => x + 1);

    const [r1, r2] = await Promise.all([
      collect<number>(s1),
      collect<number>(s2)
    ]);

    expect(r1).toEqual([0, 1, 2]);
    expect(r2).toEqual([10, 11, 12]);
  });

  it('should support promise-based condition and iterate functions', async () => {
    const atom = loop(
      Promise.resolve(0),
      async (value) => {
        await delay(1);
        return value < 2;
      },
      async (value) => {
        await delay(1);
        return value + 1;
      }
    );

    const result = await collect<number>(atom);
    expect(result).toEqual([0, 1]);
  });
});
