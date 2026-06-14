import { from, atom } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('from', () => {

  it('should emit values in sequence and complete (Array)', async () => {
    const values = [1, 2, 3];
    const atom = from(values);
    const emittedValues: number[] = [];

    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual(values);
  });

  it('should emit values from an iterable (Generator)', async () => {
    function* numberGenerator() {
      yield 10;
      yield 20;
      yield 30;
    }
    const atom = from(numberGenerator());
    const emittedValues: number[] = [];
    const expected = [10, 20, 30];

    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual(expected);
  });

  it('should stop emitting values when unsubscribe is called early', async () => {
    async function* asyncNumberGenerator() {
      yield 1;
      await delay(10);
      yield 2;
      await delay(10);
      yield 3;
    }

    const atom = from(asyncNumberGenerator());
    const emittedValues: number[] = [];

    const subscription = atom.subscribe(v => {
      if (v === 1) {
        emittedValues.push(v);
        subscription.unsubscribe();
      }
    });

    await delay(50);
    expect(emittedValues).toEqual([1]);
  });

  it('should await promised iterables before emitting', async () => {
    const promiseSource = Promise.resolve([4, 5, 6]);
    const atom = from(promiseSource);
    const collected: number[][] = [];

    atom.subscribe(v => { if (v !== undefined) collected.push(v); });
    await delay();

    expect(collected).toEqual([[4, 5, 6]]);
  });
});
