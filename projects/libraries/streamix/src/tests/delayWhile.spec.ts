import { atom, fromAtom, delayWhile, from, type Atom } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('delayWhile', () => {
  it('buffers values while the predicate returns true and flushes them when it flips', async () => {
    const source$: Atom<number> = atom<number>();
    const subject = fromAtom(source$);
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of subject.pipe(delayWhile((value) => value < 3))) {
        results.push(value);
      }
    })();

    source$.set(1);
    await wait(10);
    source$.set(2);
    await wait(10);
    source$.set(3);
    source$.dispose();
    await reader;

    expect(results).toEqual([1, 2, 3]);
  });

  it('can re-enter the delayed state after emitting once', async () => {
    const source$: Atom<number> = atom<number>();
    const subject = fromAtom(source$);
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of subject.pipe(delayWhile((value) => value % 2 === 1))) {
        results.push(value);
      }
    })();

    source$.set(1);
    await wait(10);
    source$.set(2);
    await wait(10);
    source$.set(3);
    await wait(10);
    source$.set(4);
    source$.dispose();
    await reader;

    expect(results).toEqual([1, 2, 3, 4]);
  });

  it('flushes buffered values when the source completes even if the predicate stayed true', async () => {
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of from([1, 2]).pipe(delayWhile(() => true))) {
        results.push(value);
      }
    })();

    await reader;

    expect(results).toEqual([1, 2]);
  });

  it('supports asynchronous predicate functions', async () => {
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of from([1, 2, 3]).pipe(delayWhile(async (value) => {
        await wait(5);
        return value < 3;
      }))) {
        results.push(value);
      }
    })();

    await reader;
    expect(results).toEqual([1, 2, 3]);
  });

  it('supports index parameter in predicate', async () => {
    const source$: Atom<number> = atom<number>();
    const subject = fromAtom(source$);
    const results: number[] = [];
    const indices: number[] = [];
    const reader = (async () => {
      for await (const value of subject.pipe(
        delayWhile((_, index) => {
          indices.push(index);
          return index < 2; // Delay first 2 values by index
        })
      )) {
        results.push(value);
      }
    })();

    source$.set(10);
    await wait(5);
    source$.set(20);
    await wait(5);
    source$.set(30);
    source$.dispose();
    await reader;

    expect(results).toEqual([10, 20, 30]);
    expect(indices).toEqual([0, 1, 2]);
  });

  it('uses index to delay based on position not value', async () => {
    const source$: Atom<string> = atom<string>();
    const subject = fromAtom(source$);
    const results: string[] = [];
    const reader = (async () => {
      for await (const value of subject.pipe(
        delayWhile((_, index) => index < 1) // Delay only first value
      )) {
        results.push(value);
      }
    })();

    source$.set('a');
    await wait(5);
    source$.set('b');
    source$.dispose();
    await reader;

    expect(results).toEqual(['a', 'b']);
  });
});
