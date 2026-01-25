import { createSubject, delay, exhaustMap, from, of } from '@epikodelabs/streamix';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('exhaustMap', () => {
  it('does not start a second inner stream while the first is active', async () => {
    const subject = createSubject<number>();
    const results: number[] = [];
    let projectCalls = 0;

    const stream = subject.pipe(
      exhaustMap((value) => {
        projectCalls++;
        return from([value]).pipe(delay(20));
      })
    );

    const reader = (async () => {
      for await (const value of stream) {
        results.push(value);
      }
    })();

    subject.next(1);
    await wait(5);
    subject.next(2);
    subject.next(3);
    await wait(150);
    subject.complete();
    await reader;

    expect(results).toEqual([1]);
    expect(projectCalls).toBe(1);
  });

  it('restarts after the inner stream completes', async () => {
    const subject = createSubject<number>();
    const results: number[] = [];
    let projectCalls = 0;

    const stream = subject.pipe(
      exhaustMap((value) => {
        projectCalls++;
        return from([value]).pipe(delay(50));
      })
    );

    const reader = (async () => {
      for await (const value of stream) {
        results.push(value);
      }
    })();

    subject.next(1);
    await wait(10);
    subject.next(2);
    subject.next(3);
    await wait(60);
    subject.next(4);
    await wait(60);
    subject.complete();
    await reader;

    expect(results).toEqual([1, 4]);
    expect(projectCalls).toBe(2);
  });

  it('propagates inner errors and ignores later sources', async () => {
    const subject = createSubject<number>();
    const results: number[] = [];

    const stream = subject.pipe(
      exhaustMap((value) => {
        if (value === 1) {
          return from([value]).pipe(delay(10));
        }
        if (value === 2) {
          throw new Error('boom');
        }
        return from([value]);
      })
    );

    const errPromise = (async () => {
      try {
        for await (const value of stream) {
          results.push(value);
        }
        return null;
      } catch (err) {
        return err;
      }
    })();

    subject.next(1);
    await wait(5);
    subject.next(3);
    await wait(10);
    subject.next(2);
    const error = await errPromise;

    expect(error).toBeInstanceOf(Error);
    expect((error as any)!.message).toBe('boom');
    expect(results).toEqual([1]);
  });

  describe('edge cases', () => {
    it('should ignore rapid emissions while inner is active', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];
      const processed: number[] = [];

      const exhausted = source.pipe(
        exhaustMap((val) => {
          processed.push(val);
          return new Promise<number>((resolve) => {
            setTimeout(() => resolve(val * 10), 50);
          });
        })
      );

      exhausted.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(processed).toEqual([1, 4]); // Only 1 and 4 processed
          expect(results).toEqual([10, 40]);
          done();
        }
      });

      source.next(1);
      setTimeout(() => source.next(2), 10); // Ignored
      setTimeout(() => source.next(3), 20); // Ignored
      setTimeout(() => source.next(4), 100); // Accepted
      setTimeout(() => source.complete(), 200);
    });

    it('should accept new emissions immediately after inner completes', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const exhausted = source.pipe(exhaustMap((val) => of(val * 10)));

      exhausted.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          // All sync inners complete immediately, so all accepted
          expect(results).toEqual([10, 20, 30]);
          done();
        }
      });

      source.next(1);
      source.next(2);
      source.next(3);
      source.complete();
    });

    it('should handle errors in active inner during rapid emissions', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const exhausted = source.pipe(
        exhaustMap((val) => {
          return new Promise<number>((_, reject) => {
            setTimeout(() => {
              if (val === 1) {
                reject(new Error('Error in first'));
              }
            }, 50);
          });
        })
      );

      exhausted.subscribe({
        next: (val) => results.push(val),
        error: (err) => {
          expect(err.message).toBe('Error in first');
          expect(results).toEqual([]);
          done();
        }
      });

      source.next(1);
      setTimeout(() => source.next(2), 10); // Ignored
      setTimeout(() => source.next(3), 20); // Ignored
    });

    it('should ignore emissions during re-entrant inner emissions', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];
      let reentrantEmitted = false;

      const exhausted = source.pipe(
        exhaustMap((val) => {
          const inner = createSubject<number>();
          setTimeout(() => {
            inner.next(val * 10);
            // Try to emit to source during inner emission (re-entrant)
            if (!reentrantEmitted) {
              reentrantEmitted = true;
              source.next(99); // Should be ignored
            }
            inner.complete();
          }, 20);
          return inner;
        })
      );

      exhausted.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([10]);
          expect(reentrantEmitted).toBe(true);
          done();
        }
      });

      source.next(1);
      setTimeout(() => source.complete(), 100);
    });
  });
});
