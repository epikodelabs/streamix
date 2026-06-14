import { atom, delayWhile, from, iterate, pipe } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('delayWhile', () => {
  it('buffers values while the predicate returns true and flushes them when it flips', async () => {
    const subject: ReturnType<typeof atom> = atom<atom>();
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(subject, delayWhile((value) => value < 3)))) {
        results.push(value);
      }
    })();

    subject.next(1);
    await wait(10);
    subject.next(2);
    await wait(10);
    subject.next(3);
    subject.dispose();
    await reader;

    expect(results).toEqual([1, 2, 3]);
  });

  it('can re-enter the delayed state after emitting once', async () => {
    const subject: ReturnType<typeof atom> = atom<atom>();
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(subject, delayWhile((value) => value % 2 === 1)))) {
        results.push(value);
      }
    })();

    subject.next(1);
    await wait(10);
    subject.next(2);
    await wait(10);
    subject.next(3);
    await wait(10);
    subject.next(4);
    subject.dispose();
    await reader;

    expect(results).toEqual([1, 2, 3, 4]);
  });

  it('flushes buffered values when the source completes even if the predicate stayed true', async () => {
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(from([1, 2]), delayWhile(() => true)))) {
        results.push(value);
      }
    })();

    await reader;

    expect(results).toEqual([1, 2]);
  });

  it('supports asynchronous predicate functions', async () => {
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(from([1, 2, 3]), delayWhile(async (value) => {
        await wait(5);
        return value < 3;
      })))) {
        results.push(value);
      }
    })();

    await reader;
    expect(results).toEqual([1, 2, 3]);
  });

  it('supports index parameter in predicate', async () => {
    const subject: ReturnType<typeof atom> = atom<atom>();
    const results: number[] = [];
    const indices: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(subject, delayWhile((_, index) => {
        indices.push(index);
        return index < 2;
      })))) {
        results.push(value);
      }
    })();

    subject.next(10);
    await wait(5);
    subject.next(20);
    await wait(5);
    subject.next(30);
    subject.dispose();
    await reader;

    expect(results).toEqual([10, 20, 30]);
    expect(indices).toEqual([0, 1, 2]);
  });

  it('uses index to delay based on position not value', async () => {
    const subject: ReturnType<typeof atom> = atom<atom>();
    const results: string[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(subject, delayWhile((_, index) => index < 1)))) {
        results.push(value);
      }
    })();

    subject.next('a');
    await wait(5);
    subject.next('b');
    subject.dispose();
    await reader;

    expect(results).toEqual(['a', 'b']);
  });
});
