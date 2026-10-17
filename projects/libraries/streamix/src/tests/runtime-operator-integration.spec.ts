import { concatMap, from, iterate, mergeMap, pipe } from '@epikodelabs/streamix';
import { ConcurrentInnerExecution } from '../lib/runtime/concurrent-inner-execution';
import { SerialInnerExecution } from '../lib/runtime/serial-inner-execution';

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe('Runtime higher-order execution integration', () => {
  it('mergeMap preserves all finite inner emissions with bounded concurrency', async () => {
    const output = pipe(from([1, 2, 3]), mergeMap((x: number) => [x, x * 10], 2));
    const values = await collect(iterate(output));
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 10, 20, 30]);
  });

  it('concatMap preserves sequential inner ordering', async () => {
    const output = pipe(from([1, 2, 3]), concatMap((x: number) => [x, x * 10]));
    expect(await collect(iterate(output))).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it('drops overflow values when mergeMap has no buffer', () => {
    const started: number[] = [];
    const execution = new ConcurrentInnerExecution(1, 0, value => started.push(value));
    execution.accept(1);
    execution.accept(2);
    execution.complete();
    expect(started).toEqual([1]);
    expect(execution.idle).toBe(true);
  });

  it('releases concurrency capacity after synchronous projection failure', () => {
    const started: number[] = [];
    const execution = new ConcurrentInnerExecution(1, 2, value => {
      started.push(value);
      if (value === 1) throw new Error('projection failed');
    });
    expect(() => execution.accept(1)).toThrowError('projection failed');
    execution.accept(2);
    expect(started).toEqual([1, 2]);
    execution.complete();
    expect(execution.idle).toBe(true);
  });

  it('ignores a late inner result after disposal', async () => {
    let resolve!: (result: IteratorResult<number>) => void;
    const pendingResult = new Promise<IteratorResult<number>>(r => { resolve = r; });
    let cancelled = 0;
    const execution = new SerialInnerExecution<number>();
    execution.attach({
      next: () => pendingResult,
      return: async () => { cancelled++; return { done: true, value: undefined }; }
    });
    const pending = execution.next();
    await execution.close();
    resolve({ done: false, value: 99 });
    expect((await pending).done).toBe(true);
    expect(cancelled).toBe(1);
  });

  it('cancels an attached inner iterator only once', async () => {
    let cancelled = 0;
    const execution = new SerialInnerExecution<number>();
    execution.attach({
      next: async () => ({ done: true, value: undefined }),
      return: async () => { cancelled++; return { done: true, value: undefined }; }
    });
    await Promise.all([execution.close(), execution.close()]);
    expect(cancelled).toBe(1);
  });
});
