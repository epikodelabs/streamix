import {atom, filter, from, iterate, mergeMap, pipe, type Atom} from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mergeMap', () => {
  it('should merge emissions from inner streams correctly', async () => {
    const testStream = from([1, 2, 3]);

    const project = (value: number) => [value * 2, value * 4];

    const mergedAtom = pipe(testStream, mergeMap(project));

    const results: any[] = [];
    for await (const value of iterate(mergedAtom)) {
      results.push(value);
    }

    results.sort((a, b) => a - b);
    expect(results).toEqual([2, 4, 4, 6, 8, 12]);
  });

  it('should correctly handle a chain of from, filter, mergeMap, filter, and mergeMap', async () => {
    const testStream = from([1, 2, 3, 4, 5, 6]);

    // Project functions for mergeMap
    const firstProject = (value: number) => [value, value * 10];
    const secondProject = (value: number) => [value * 2];

    // Create the chained stream
    const chainedAtom = pipe(
      testStream,
      filter((value: number) => value % 2 === 0),
      mergeMap(firstProject),
      filter((value: number) => value > 10),
      mergeMap(secondProject)
    );

    const results: number[] = [];
    let emissionCounter = 0;

    for await (const value of iterate(chainedAtom)) {
      results.push(value);
      emissionCounter++;
    }

    results.sort((a, b) => a - b);

    expect(results).toEqual([40, 80, 120]);
    expect(emissionCounter).toBe(results.length);
  });

  it('should handle inner Observable that emits nothing', async () => {
    const testStream = from([1, 2, 3]);

    const project = () => [];

    const mergedAtom = pipe(testStream, mergeMap(project));

    const results: number[] = [];
    for await (const value of iterate(mergedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it('should handle inner Observable that errors out', async () => {
    const testStream = from([1, 2, 3]);

    const project = (value: number) => {
      if (value === 2) {
        throw new Error('Inner observable error');
      }
      return [value * 2];
    };

    const mergedAtom = pipe(testStream, mergeMap(project));

    const results: number[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const value of iterate(mergedAtom)) {
        results.push(value);
      }
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError?.message).toBe('Inner observable error');
  });

  it('should merge inner Observable that emits multiple values', async () => {
    const testStream = from([1, 2]);

    const project = (value: number) => [value * 2, value * 3];

    const mergedAtom = pipe(testStream, mergeMap(project));

    const results: number[] = [];
    for await (const value of iterate(mergedAtom)) {
      results.push(value);
    }

    expect(results.sort((a, b) => a - b)).toEqual([2, 3, 4, 6]);
  });

  it('should handle an empty source Observable', async () => {
    const testStream = from([]);

    const project = (value: number) => [value * 2];

    const mergedAtom = pipe(testStream, mergeMap(project));

    const results: number[] = [];
    for await (const value of iterate(mergedAtom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });

  it('should handle rapid emissions from the source', async () => {
    const testStream = from([1, 2, 3, 4, 5]);

    const project = (value: number) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(value * 2), value * 10));

    const mergedAtom = pipe(testStream, mergeMap(project));

    const results: number[] = [];
    for await (const value of iterate(mergedAtom)) {
      results.push(value);
    }

    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
  });

  it('should wait for all inner Observables to complete', async () => {
    const testStream = from([1, 2, 3]);

    const project = (value: number) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(value * 2), value * 10));

    const mergedAtom = pipe(testStream, mergeMap(project));

    const results: number[] = [];
    for await (const value of iterate(mergedAtom)) {
      results.push(value);
    }

    expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6]);
  });

  it('edge: should run all rapid emissions concurrently', async () => {
    const source: Atom<any> = atom<number>();
    const results: number[] = [];
    const startTimes: number[] = [];

    const merged = pipe(
      source,
      mergeMap((val) => {
        startTimes.push(Date.now());
        return new Promise<number>((resolve) => {
          setTimeout(() => resolve(val * 10), (4 - val) * 20);
        });
      })
    );

    const reader = (async () => {
      for await (const val of iterate(merged)) {
        results.push(val);
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3);
    source.dispose();

    await reader;

    expect(results).toEqual([30, 20, 10]);
    const maxDiff = Math.max(...startTimes) - Math.min(...startTimes);
    expect(maxDiff).toBeLessThan(50);
  });

  it('edge: should handle mix of sync and async inners concurrently', async () => {
    const source: Atom<any> = atom<number>();
    const results: number[] = [];

    const merged = pipe(
      source,
      mergeMap((val) => {
        if (val % 2 === 0) {
          return [val * 10]; // sync
        }
        return new Promise<number>((resolve) => {
          setTimeout(() => resolve(val * 10), 50);
        });
      })
    );

    const reader = (async () => {
      for await (const val of iterate(merged)) {
        results.push(val);
      }
    })();

    source.next(1); // async
    source.next(2); // sync
    source.next(3); // async
    source.next(4); // sync
    source.dispose();

    await reader;

    expect(results).toEqual([20, 40, 10, 30]);
  });

  it('edge: should continue other inners when one errors', async () => {
    const source: Atom<any> = atom<number>();
    const results: number[] = [];
    let caughtError: Error | undefined;

    const merged = pipe(
      source,
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

    const reader = (async () => {
      try {
        for await (const val of iterate(merged)) {
          results.push(val);
        }
      } catch (err) {
        caughtError = err as Error;
      }
    })();

    source.next(1);
    source.next(2);
    source.next(3);
    source.dispose();

    await reader;

    expect(caughtError?.message).toBe('Error at 2');
    expect(results).toEqual([10]);
  });

  it('edge: should handle rapid emissions with varying inner durations', async () => {
    const source: Atom<any> = atom<number>();
    const results: number[] = [];

    const merged = pipe(
      source,
      mergeMap((val, index) => {
        const delayMs = index === 0 ? 100 : index === 1 ? 50 : 10;
        return new Promise<number>((resolve) => {
          setTimeout(() => resolve(val * 10), delayMs);
        });
      })
    );

    const reader = (async () => {
      for await (const val of iterate(merged)) {
        results.push(val);
      }
    })();

    source.next(1); // 100ms
    source.next(2); // 50ms
    source.next(3); // 10ms
    source.dispose();

    await reader;

    expect(results).toEqual([30, 20, 10]);
  });

  it('edge: should handle unsubscribe with multiple active inners', async () => {
    const source: Atom<any> = atom<number>();
    const results: number[] = [];
    const completions: number[] = [];

    const merged = pipe(
      source,
      mergeMap((val) => {
        return new Promise<number>((resolve) => {
          setTimeout(() => {
            completions.push(val);
            resolve(val * 10);
          }, val * 30);
        });
      })
    );

    const sub = merged.subscribe((val: number) => {
      results.push(val);
      if (val === 10) {
        sub.unsubscribe();
      }
    });

    source.next(1);
    source.next(2);
    source.next(3);

    await wait(150);

    expect(results).toEqual([10]);
    expect(completions).toEqual([1, 2, 3]);
  });
});

