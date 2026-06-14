import { catchError, createStream, endWith, finalize, from, iterate, pipe, startWith, tap } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('tap', () => {
  it('should perform side effects for each emission', async () => {
    const sideEffectFn = jasmine.createSpy('sideEffectFn');

    const atom = pipe(
      from([1, 2, 3]),
      startWith(0),
      endWith(4),
      tap(sideEffectFn),
      catchError(),
      finalize(() => {})
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(sideEffectFn).toHaveBeenCalledTimes(5);
    expect(sideEffectFn).toHaveBeenCalledWith(0);
    expect(sideEffectFn).toHaveBeenCalledWith(1);
    expect(sideEffectFn).toHaveBeenCalledWith(2);
    expect(sideEffectFn).toHaveBeenCalledWith(3);
    expect(sideEffectFn).toHaveBeenCalledWith(4);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('should await async side effects', async () => {
    const delays: number[] = [];
    const start = Date.now();

    const atom = pipe(
      from([1, 2, 3]),
      tap(async (value: number) => {
        await new Promise(r => setTimeout(r, 20));
        delays.push(value);
      })
    );

    const results: number[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    const elapsed = Date.now() - start;
    expect(results).toEqual([1, 2, 3]);
    expect(delays).toEqual([1, 2, 3]);
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it('should propagate early unsubscribe upstream', async () => {
    let cleaned = false;

    const source = createStream('tap-cleanup', async function* (signal) {
      try {
        yield 1;
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        cleaned = true;
      }
    });

    const atom = pipe(source, tap(() => {}));
    const iterator = iterate(atom)[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBeFalse();
    expect(first.value).toBe(1);

    await iterator.return!();
    await delay(10);

    expect(cleaned).toBeTrue();
  });
});
