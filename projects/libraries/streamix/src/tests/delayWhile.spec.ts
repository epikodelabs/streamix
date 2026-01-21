import { createSubject, from } from '@epikodelabs/streamix';
import { delayWhile } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('delayWhile', () => {
  it('buffers values while the predicate returns true and flushes them when it flips', async () => {
    const subject = createSubject<number>();
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of subject.pipe(delayWhile((value) => value < 3))) {
        results.push(value);
      }
    })();

    subject.next(1);
    await wait(10);
    subject.next(2);
    await wait(10);
    subject.next(3);
    subject.complete();
    await reader;

    expect(results).toEqual([1, 2, 3]);
  });

  it('can re-enter the delayed state after emitting once', async () => {
    const subject = createSubject<number>();
    const results: number[] = [];
    const reader = (async () => {
      for await (const value of subject.pipe(delayWhile((value) => value % 2 === 1))) {
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
    subject.complete();
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
});
