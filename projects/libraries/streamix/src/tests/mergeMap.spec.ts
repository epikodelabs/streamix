import { createSubject, delay, EMPTY, filter, from, map, mergeMap, of, take, timer } from '@epikodelabs/streamix';

describe('mergeMap', () => {
  it('should merge emissions from inner streams correctly', (done) => {
    const testStream = from([1, 2, 3]);

    const project = (value: number) => from([value * 2, value * 4]);

    const mergedStream = testStream.pipe(mergeMap(project));

    let results: any[] = [];

    mergedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        results.sort((a, b) => a - b);
        expect(results).toEqual([2, 4, 4, 6, 8, 12]);
        done();
      }
    });
  });

  it('should correctly handle a chain of from, filter, mergeMap, filter, and mergeMap', (done) => {
    const testStream = from([1, 2, 3, 4, 5, 6]);

    // Project functions for mergeMap
    const firstProject = (value: number) => from([value, value * 10]);
    const secondProject = (value: number) => from([value * 2]);

    // Create the chained stream
    const chainedStream = testStream.pipe(
      // Filter: Keep only even numbers
      filter((value) => value % 2 === 0),
      // MergeMap: Project each even number into an array [value, value * 10]
      mergeMap(firstProject),
      // Filter: Keep values greater than 10
      filter((value) => value > 10),
      // MergeMap: Project each value into its double
      mergeMap(secondProject)
    );

    let results: number[] = [];
    let emissionCounter = 0; // Assume you're tracking emissions this way

    chainedStream.subscribe({
      next: (value) => {
        results.push(value);
        emissionCounter++; // Increment the counter for each emission
      },
      complete: () => {
        // Sort results for easier comparison
        results.sort((a, b) => a - b);

        // Validate the results
        expect(results).toEqual([40, 80, 120]);
        expect(emissionCounter).toBe(results.length); // Emission counter matches the number of emissions
        done();
      },
    });
  });

  it('should handle inner Observable that emits nothing', (done) => {
    const testStream = from([1, 2, 3]);

    const project = () => EMPTY; // Inner observable emits nothing

    const mergedStream = testStream.pipe(mergeMap(project));

    const results: number[] = [];

    mergedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([]); // No emissions
        done();
      },
    });
  });

  it('should handle inner Observable that errors out', (done) => {
    const testStream = from([1, 2, 3]);

    const project = (value: number) => {
      if (value === 2) {
        throw new Error('Inner observable error');
      }
      return from([value * 2]);
    };

    const mergedStream = testStream.pipe(mergeMap(project));

    const results: number[] = [];

    mergedStream.subscribe({
      next: (value) => results.push(value),
      error: (err) => {
        expect(err.message).toBe('Inner observable error');
        done();
      },
    });
  });

  it('should merge inner Observable that emits multiple values', (done) => {
    const testStream = from([1, 2]);

    const project = (value: number) => from([value * 2, value * 3]);

    const mergedStream = testStream.pipe(mergeMap(project));

    const results: number[] = [];

    mergedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results.sort((a, b) => a - b)).toEqual([2, 3, 4, 6]); // Sorted results
        done();
      },
    });
  });

  it('should handle an empty source Observable', (done) => {
    const testStream = EMPTY;

    const project = (value: number) => from([value * 2]);

    const mergedStream = testStream.pipe(mergeMap(project));

    const results: number[] = [];

    mergedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([]); // No emissions
        done();
      },
    });
  });

  it('should handle rapid emissions from the source', (done) => {
    const testStream = from([1, 2, 3, 4, 5]);

    const project = (value: number) =>
      from([value * 2]).pipe(delay(value * 10)); // Delay emissions based on value

    const mergedStream = testStream.pipe(mergeMap(project));

    const results: number[] = [];

    mergedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]); // Ordered by values processed
        done();
      },
    });
  });

  it('should wait for all inner Observables to complete', (done) => {
    const testStream = from([1, 2, 3]);

    const project = (value: number) => timer(value * 10).pipe(map(() => value * 2), take(1));

    const mergedStream = testStream.pipe(mergeMap(project));

    const results: number[] = [];

    mergedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([2, 4, 6]); // Inner streams complete in order
        done();
      },
    });
  });

  it('edge: should run all rapid emissions concurrently', (done) => {
    const source = createSubject<number>();
    const results: number[] = [];
    const startTimes: number[] = [];

    const merged = source.pipe(
      mergeMap((val) => {
        startTimes.push(Date.now());
        return new Promise<number>((resolve) => {
          setTimeout(() => resolve(val * 10), (4 - val) * 20);
        });
      })
    );

    merged.subscribe({
      next: (val) => results.push(val),
      complete: () => {
        // Results should be in completion order, not emission order
        expect(results).toEqual([30, 20, 10]);
        // All should start nearly simultaneously
        const maxDiff = Math.max(...startTimes) - Math.min(...startTimes);
        expect(maxDiff).toBeLessThan(50);
        done();
      }
    });

    source.next(1);
    source.next(2);
    source.next(3);
    source.complete();
  });

  it('edge: should handle mix of sync and async inners concurrently', (done) => {
    const source = createSubject<number>();
    const results: number[] = [];

    const merged = source.pipe(
      mergeMap((val) => {
        if (val % 2 === 0) {
          return of(val * 10); // sync
        }
        return new Promise<number>((resolve) => {
          setTimeout(() => resolve(val * 10), 50);
        });
      })
    );

    merged.subscribe({
      next: (val) => results.push(val),
      complete: () => {
        // Sync values first, then async
        expect(results).toEqual([20, 40, 10, 30]);
        done();
      }
    });

    source.next(1); // async
    source.next(2); // sync
    source.next(3); // async
    source.next(4); // sync
    source.complete();
  });

  it('edge: should continue other inners when one errors', (done) => {
    const source = createSubject<number>();
    const results: number[] = [];

    const merged = source.pipe(
      mergeMap((val) => {
        return new Promise<number>((resolve, reject) => {
          setTimeout(() => {
            if (val === 2) {
              reject(new Error('Error at 2'));
            } else {
              resolve(val * 10);
            }
          }, val * 20);
        });
      })
    );

    merged.subscribe({
      next: (val) => results.push(val),
      error: (err) => {
        expect(err.message).toBe('Error at 2');
        // First value completes before error
        expect(results).toEqual([10]);
        done();
      }
    });

    source.next(1);
    source.next(2);
    source.next(3);
    source.complete();
  });

  it('edge: should handle rapid emissions with varying inner durations', (done) => {
    const source = createSubject<number>();
    const results: number[] = [];

    const merged = source.pipe(
      mergeMap((val, index) => {
        const delayMs = index === 0 ? 100 : index === 1 ? 50 : 10;
        return new Promise<number>((resolve) => {
          setTimeout(() => resolve(val * 10), delayMs);
        });
      })
    );

    merged.subscribe({
      next: (val) => results.push(val),
      complete: () => {
        // Should complete in reverse order of delays
        expect(results).toEqual([30, 20, 10]);
        done();
      }
    });

    source.next(1); // 100ms
    source.next(2); // 50ms
    source.next(3); // 10ms
    source.complete();
  });

  it('edge: should handle unsubscribe with multiple active inners', (done) => {
    const source = createSubject<number>();
    const results: number[] = [];
    const completions: number[] = [];

    const merged = source.pipe(
      mergeMap((val) => {
        return new Promise<number>((resolve) => {
          setTimeout(() => {
            completions.push(val);
            resolve(val * 10);
          }, val * 30);
        });
      })
    );

    const sub = merged.subscribe({
      next: (val) => {
        results.push(val);
        if (val === 10) {
          sub.unsubscribe();
        }
      }
    });

    source.next(1);
    source.next(2);
    source.next(3);

    setTimeout(() => {
      expect(results).toEqual([10]);
      // Unsubscribe stops delivery, but does not cancel already-started work.
      expect(completions).toEqual([1, 2, 3]);
      done();
    }, 150);
  });
});


