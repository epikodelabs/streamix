import { catchError, createStream, endWith, finalize, from, startWith, tap } from '@epikodelabs/streamix';

describe('tap', () => {
  it('should perform side effects for each emission', (done) => {
    const testStream = from([1, 2, 3]);
    const sideEffectFn = jasmine.createSpy('sideEffectFn');

    const tappedStream = testStream.pipe(startWith(0), endWith(4), tap(sideEffectFn), catchError(console.log), finalize(() => {}));

    let results: any[] = [];

    tappedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(sideEffectFn).toHaveBeenCalledTimes(5);

        expect(sideEffectFn).toHaveBeenCalledWith(0);
        expect(sideEffectFn).toHaveBeenCalledWith(1);
        expect(sideEffectFn).toHaveBeenCalledWith(2);
        expect(sideEffectFn).toHaveBeenCalledWith(3);
        expect(sideEffectFn).toHaveBeenCalledWith(4);

        expect(results).toEqual([0, 1, 2, 3, 4]);

        done();
      },
      error: done.fail,
    });
  });

  it('should await async side effects', async () => {
    const delays: number[] = [];
    const start = Date.now();

    const stream = from([1, 2, 3]).pipe(
      tap(async (value) => {
        await new Promise(r => setTimeout(r, 20));
        delays.push(value);
      })
    );

    await stream.toArray();

    const elapsed = Date.now() - start;
    expect(delays).toEqual([1, 2, 3]);
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it('should propagate early unsubscribe upstream', (done) => {
    let cleaned = false;

    const stream = createStream('tap-cleanup', async function* (signal) {
      try {
        yield 1;
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      } finally {
        cleaned = true;
      }
    });

    let subscription: ReturnType<typeof stream.subscribe>;
    subscription = stream.pipe(tap(() => {})).subscribe({
      next: () => {
        void subscription.unsubscribe();
      },
      complete: () => {}
    });

    setTimeout(() => {
      expect(cleaned).toBeTrue();
      done();
    }, 0);
  });
});


