import { pipe } from '@epikodelabs/streamix';
import { every, none, some } from '@epikodelabs/streamix/aggregates';

/**
 * The short-circuit aggregates (every / some / none) must close their source
 * when they finish early, otherwise the underlying generator stays suspended
 * mid-stream and any resources it holds (open HTTP bodies, timers, locks)
 * are never released.
 */
describe('short-circuit aggregates close the source', () => {
  async function* trackingSource<T>(values: T[], onFinally: () => void): AsyncGenerator<T> {
    try {
      for (const value of values) {
        yield value;
      }
    } finally {
      onFinally();
    }
  }

  async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const value of source) {
      out.push(value);
    }
    return out;
  }

  it('some() closes the source after the first match', async () => {
    let finalized = false;
    const stream = pipe(
      trackingSource([1, 2, 3], () => { finalized = true; }),
      some((value: number) => value === 2),
    );

    expect(await collect(stream)).toEqual([true]);
    expect(finalized).toBe(true);
  });

  it('every() closes the source after the first failure', async () => {
    let finalized = false;
    const stream = pipe(
      trackingSource([1, 2, 3], () => { finalized = true; }),
      every((value: number) => value < 2),
    );

    expect(await collect(stream)).toEqual([false]);
    expect(finalized).toBe(true);
  });

  it('none() closes the source after the first match', async () => {
    let finalized = false;
    const stream = pipe(
      trackingSource([1, 2, 3], () => { finalized = true; }),
      none((value: number) => value === 3),
    );

    expect(await collect(stream)).toEqual([false]);
    expect(finalized).toBe(true);
  });
});
