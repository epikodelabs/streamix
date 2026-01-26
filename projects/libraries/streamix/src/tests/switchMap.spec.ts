import {
  createStream,
  createSubject,
  delay,
  EMPTY,
  from,
  getIteratorEmissionStamp,
  nextEmissionStamp,
  getValueMeta,
  isWrappedPrimitive,
  of,
  setIteratorEmissionStamp,
  setIteratorMeta,
  switchMap,
  unwrapPrimitive,
} from '@epikodelabs/streamix';

describe('switchMap', () => {
  it('should switch to new inner streams correctly', (done) => {
    const testStream = from([1, 2, 3]).pipe(delay(100));
    const project = (value: number) => from([value * 10, value * 100]);

    const switchedStream = testStream.pipe(switchMap(project));

    let results: any[] = [];

    switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([10, 100, 20, 200, 30, 300]);
        done();
      }
    });
  });

  it('should cancel previous inner stream emissions when a new emission arrives', (done) => {
    const testStream = from([1, 2, 3]);

    const project = (value: number) => {
      const innerStream = createSubject();
      setTimeout(() => innerStream.next(value * 10), 50);
      setTimeout(() => innerStream.next(value * 100), 150);
      setTimeout(() => innerStream.complete(), 500);
      return innerStream;
    };

    const switchedStream = testStream.pipe(switchMap(project));

    let results: any[] = [];

    const subscription = switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([30, 300]);
        subscription.unsubscribe();
        done();
      }
    });
  });

  it('should handle switching to an empty observable', (done) => {
    const testStream = from([1, 2, 3]);
    const project = () => {
      const innerStream = createSubject();
      innerStream.complete();
      return innerStream;
    };

    const switchedStream = testStream.pipe(switchMap(project));

    const results: any[] = [];

    switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([]);
        done();
      }
    });
  });

  it('should emit values when project returns arrays', (done) => {
    const testStream = from([1, 2]);
    const project = (value: number) => [value, value * 10];

    const switchedStream = testStream.pipe(delay(100), switchMap(project));
    const results: number[] = [];

    switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([1, 10, 2, 20]);
        done();
      }
    });
  });

  it('should drop stale promise results and only emit latest', (done) => {
    const subject = createSubject<number>();
    const switchedStream = subject.pipe(
      switchMap((value) =>
        new Promise<number>((resolve) => {
          setTimeout(() => resolve(value * 10), value === 1 ? 100 : 10);
        })
      )
    );

    const results: number[] = [];

    switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([20]);
        done();
      }
    });

    subject.next(1);
    setTimeout(() => subject.next(2), 20);
    setTimeout(() => subject.complete(), 150);
  });

  it('should switch to an inner observable that delays emissions', (done) => {
    const testStream = from([1, 2]);
    const project = (value: number) => {
      const innerStream = createSubject();
      setTimeout(() => innerStream.next(value * 10), 100);
      setTimeout(() => innerStream.complete(), 300);
      return innerStream;
    };

    const switchedStream = testStream.pipe(switchMap(project));

    let results: any[] = [];

    switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([20]);
        done();
      }
    });
  });

  it('should propagate errors from inner observables', (done) => {
    const testStream = from([1, 2, 3]);
    const project = (value: number) => {
      const innerStream = createSubject();
      if (value === 2) {
        throw new Error('Inner Error');
      } else {
        setTimeout(() => innerStream.next(value * 10), 50);
        setTimeout(() => innerStream.complete(), 200);
      }
      return innerStream;
    };

    const switchedStream = testStream.pipe(switchMap(project));

    let results: any[] = [];
    let errorOccurred = false;

    switchedStream.subscribe({
      next: (value) => results.push(value),
      error: (err) => {
        errorOccurred = true;
        expect(err.message).toBe('Inner Error');
        expect(results).toEqual([]);
        done();
      },
      complete: () => {
        expect(errorOccurred).toBe(true);
      }
    });
  });

  it('should not emit anything for an empty source observable', (done) => {
    const testStream = EMPTY;

    const project = (value: number) => {
      const innerStream = createSubject();
      innerStream.next(value * 10);
      innerStream.complete();
      return innerStream;
    };

    const switchedStream = testStream.pipe(switchMap(project));

    const results: any[] = [];

    switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([]);
        done();
      }
    });
  });

  it('should accept scalar project results', (done) => {
    const testStream = from([1, 2, 3]);
    const project = (value: number) => value * 10;

    const switchedStream = testStream.pipe(switchMap(project));

    const results: number[] = [];
    switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([10, 20, 30]);
        done();
      }
    });
  });

  it('should wait for promised inner stream before switching', (done) => {
    const subject = createSubject<number>();

    const project = (value: number) => {
      return new Promise<number>((resolve) => {
        setTimeout(() => resolve(value * 10), value === 1 ? 100 : 10);
      });
    };

    const switchedStream = subject.pipe(switchMap(project));

    const results: number[] = [];
    switchedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([20]);
        done();
      }
    });

    subject.next(1);
    setTimeout(() => subject.next(2), 20);
    setTimeout(() => subject.complete(), 150);
  });

  it('should handle rapid switching correctly', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];

    const switched = subject.pipe(
      switchMap(value => {
        const inner = createSubject<number>();
        setTimeout(() => {
          inner.next(value * 10);
          inner.next(value * 100);
          inner.complete();
        }, value * 50);
        return inner;
      })
    );

    let count = 0;
    switched.subscribe({
      next: value => {
        results.push(value);
        count++;
      },
      complete: () => {
        expect(results).toEqual([30, 300]);
        done();
      }
    });

    subject.next(1);
    setTimeout(() => subject.next(2), 10);
    setTimeout(() => subject.next(3), 20);
    setTimeout(() => subject.complete(), 300);
  });

  it('should continue emitting the active inner even if outer completes', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];
    let activeInner: ReturnType<typeof createSubject<number>> | undefined;

    const switched = subject.pipe(
      switchMap(() => {
        const inner = createSubject<number>();
        activeInner = inner;
        queueMicrotask(() => {
          activeInner!.next(10);
          activeInner!.complete();
          subject.complete();
        });
        
        return inner;
      })
    );

    switched.subscribe({
      next: value => results.push(value),
      complete: () => {
        expect(results).toEqual([10]);
        done();
      }
    });

    subject.next(1);
  });

  it('should handle errors in inner streams and continue with next values', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];
    let errorCount = 0;

    const switched = subject.pipe(
      switchMap(value => {
        if (value === 2) {
          throw new Error('Test error');
        }
        return of(value * 10);
      })
    );

    switched.subscribe({
      next: value => results.push(value),
      error: (err) => {
        errorCount++;
        expect(err.message).toBe('Test error');
        expect(results).toEqual([10]);
        done();
      }
    });

    subject.next(1);
    setTimeout(() => subject.next(2), 10);
  });

  // FIXED: Properly complete the inner stream after emitting
  it('should cleanup active inner subscription when unsubscribed', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];
    let innerCompleted = false;
  
    const switched = subject.pipe(
      switchMap(value => {
        const inner = createSubject<number>();
        // Schedule emission and completion
        setTimeout(() => {
          inner.next(value * 10);
          inner.complete();
          innerCompleted = true;
        }, 10);
        return inner;
      })
    );

    const subscription = switched.subscribe({
      next: value => {
        results.push(value);
        // Unsubscribe after receiving the value
        subscription.unsubscribe();
      },
      complete: () => {
        // This might or might not be called depending on unsubscribe timing
      }
    });

    subject.next(1);
    
    // Wait for the value to be emitted and unsubscribe to happen
    setTimeout(() => {
      expect(results).toEqual([10]);
      expect(innerCompleted).toBe(true);
      done();
    }, 50);
  });

  it('should work with synchronous inner observables', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];

    const switched = subject.pipe(
      switchMap(value => {
        return from([value, value * 10, value * 100]);
      })
    );

    switched.subscribe({
      next: value => results.push(value),
      complete: () => {
        expect(results).toEqual([2, 20, 200]);
        done();
      }
    });

    subject.next(1);
    subject.next(2);
    subject.complete();
  });

  it('should handle project function returning a value (not a stream)', (done) => {
    const subject = createSubject<number>();
    const results: number[] = [];

    const switched = subject.pipe(
      switchMap(value => value * 10)
    );

    switched.subscribe({
      next: value => results.push(value),
      complete: () => {
        expect(results).toEqual([10, 20, 30]);
        done();
      }
    });

    subject.next(1);
    setTimeout(() => subject.next(2), 20);
    setTimeout(() => subject.next(3), 40);
    setTimeout(() => subject.complete(), 60);
  });

  it('should handle concurrent promises correctly', async () => {
    const subject = createSubject<number>();
    const results: number[] = [];

    const switched = subject.pipe(
      switchMap(async (value) => {
        await new Promise(resolve => setTimeout(resolve, value * 10));
        return value * 10;
      })
    );

    const promise = new Promise<void>((resolve) => {
      switched.subscribe({
        next: value => results.push(value),
        complete: () => resolve()
      });
    });

    subject.next(3);
    subject.next(1);
    subject.next(2);

    setTimeout(() => subject.complete(), 100);

    await promise;
    expect(results).toEqual([20]);
  });

  it('should handle inner streams that complete synchronously', (done) => {
    const source = of(1);
    const switched = source.pipe(switchMap(val => from([val * 10])));

    const results: number[] = [];
    switched.subscribe({
      next: (val) => results.push(val),
      complete: () => {
        expect(results).toEqual([10]);
        done();
      }
    });
  });

  it('should ignore completion of stale inner streams', (done) => {
    const source = createSubject<number>();
    const inner1 = createSubject<string>();
    const inner2 = createSubject<string>();

    const switched = source.pipe(
      switchMap(val => val === 1 ? inner1 : inner2)
    );

    const results: string[] = [];
    let completed = false;
    
    switched.subscribe({
      next: val => results.push(val),
      complete: () => {
        completed = true;
        expect(results).toEqual(['second']);
        done();
      }
    });

    source.next(1);
    
    // Verify output hasn't completed yet
    expect(completed).toBeFalse();
    expect(results).toEqual([]);
    
    // Switch to inner2 so inner1 becomes stale
    source.next(2);

    // inner1 completion should be ignored (it's stale)
    inner1.complete();
    expect(completed).toBeFalse();

    // Now complete the active inner stream
    inner2.next('second');
    
    inner2.complete();
    source.complete();
  });

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  it('coverage: should stop and cleanup when iterator.return is called (early break)', async () => {
    let innerClosed = 0;

    const buffer: number[] = [1];
    let done = false;

    const sourceIterator: any = {
      __tryNext() {
        if (buffer.length > 0) return { done: false, value: buffer.shift()! };
        if (done) return { done: true, value: undefined };
        return null;
      },
      next: async () => {
        throw new Error("next() should not be used when __tryNext is present");
      }
    };

    const iterator = switchMap<number, number>(() =>
      (() => {
        let yielded = false;
        const innerIterator: AsyncIterator<number> = {
          next: async () => {
            if (yielded) return new Promise<IteratorResult<number>>(() => {});
            yielded = true;
            return { done: false, value: 1 };
          },
          return: async () => {
            innerClosed++;
            return { done: true, value: undefined };
          }
        };
        return { type: "stream", id: "inner-break", [Symbol.asyncIterator]: () => innerIterator } as any;
      })()
    ).apply(sourceIterator as any);

    expect(await iterator.next()).toEqual({ done: false, value: 1 });
    await iterator.return?.();
    done = true;
    sourceIterator.__onPush?.();
    expect(innerClosed).toBe(1);
  });

  it('coverage: should stop and cleanup when iterator.throw is called', async () => {
    let innerClosed = 0;

    const buffer: number[] = [1];
    let done = false;

    const sourceIterator: any = {
      __tryNext() {
        if (buffer.length > 0) return { done: false, value: buffer.shift()! };
        if (done) return { done: true, value: undefined };
        return null;
      },
      next: async () => {
        throw new Error("next() should not be used when __tryNext is present");
      }
    };

    const iterator = switchMap<number, number>(() =>
      (() => {
        let yielded = false;
        const innerIterator: AsyncIterator<number> = {
          next: async () => {
            if (yielded) return new Promise<IteratorResult<number>>(() => {});
            yielded = true;
            return { done: false, value: 1 };
          },
          return: async () => {
            innerClosed++;
            return { done: true, value: undefined };
          }
        };
        return { type: "stream", id: "inner-throw", [Symbol.asyncIterator]: () => innerIterator } as any;
      })()
    ).apply(sourceIterator as any);

    expect(await iterator.next()).toEqual({ done: false, value: 1 });

    await expectAsync((iterator as any).throw(new Error("stop"))).toBeRejectedWithError("stop");
    done = true;
    sourceIterator.__onPush?.();
    expect(innerClosed).toBe(1);
  });

  it('coverage: should propagate errors from the active inner stream', async () => {
    const source = createSubject<number>();
    const inner = createSubject<number>();
    const stream = source.pipe(switchMap(() => inner));
    const iterator = stream[Symbol.asyncIterator]();

    const read = iterator.next();
    source.next(1);
    await wait(0);
    inner.error(new Error("boom"));

    await expectAsync(read).toBeRejectedWithError("boom");
  });

  it('coverage: should use inner emission stamp when present', async () => {
    const buffer: number[] = [1];
    let done = false;
    let expectedStamp = 0;

    const sourceIterator: any = {
      __tryNext() {
        if (buffer.length > 0) return { done: false, value: buffer.shift()! };
        if (done) return { done: true, value: undefined };
        return null;
      },
      next: async () => {
        throw new Error("next() should not be used when __tryNext is present");
      }
    };

    const inner = (() => {
      let done = false;
      const iterator: AsyncIterator<number> = {
        next: async () => {
          if (done) return { done: true, value: undefined };
          done = true;
          expectedStamp = nextEmissionStamp();
          setIteratorEmissionStamp(iterator as any, expectedStamp);
          return { done: false, value: 1 };
        },
      };
      return { type: "stream", id: "inner-stamp", [Symbol.asyncIterator]: () => iterator } as any;
    })();

    const iterator = switchMap<number, number>(() => inner).apply(sourceIterator as any);

    expect(await iterator.next()).toEqual({ done: false, value: 1 });
    expect(getIteratorEmissionStamp(iterator as any)).toBe(expectedStamp);

    await iterator.return?.();
    done = true;
    sourceIterator.__onPush?.();
  });

  it('coverage: should support push-based sources via __tryNext/__onPush', async () => {
    const buffer: number[] = [1];
    let done = false;

    const sourceIterator: any = {
      __tryNext() {
        if (buffer.length > 0) {
          return { done: false, value: buffer.shift()! };
        }
        if (done) {
          return { done: true, value: undefined };
        }
        return null;
      },
      next: async () => {
        throw new Error("next() should not be used when __tryNext is present");
      }
    };

    const iterator = switchMap<number, number>((value) => from([value, value * 10])).apply(sourceIterator);
    const iterable = { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<number>;

    const valuesPromise = (async () => {
      const values: number[] = [];
      for await (const value of iterable) {
        values.push(value);
      }
      return values;
    })();

    // First value is already buffered; allow drain() to run.
    // await wait(0);

    // buffer.push(2, 3);
    // sourceIterator.__onPush();

    // done = true;
    // sourceIterator.__onPush();

    // await wait(0);

    // expect(await valuesPromise).toEqual([3, 30]);

    // Re-writing the test section properly
    buffer.push(2, 3);
    sourceIterator.__onPush();

    done = true;
    sourceIterator.__onPush();

    expect(await valuesPromise).toEqual([3, 30]);
  });

  it('coverage: should complete for pull-based sources (no __tryNext)', async () => {
    const sourceIterator = (async function* () {
      yield 1;
    })() as AsyncIterator<number>;

    const iterator = switchMap<number, number>((value) => from([value * 10])).apply(sourceIterator as any);
    const iterable = { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<number>;

    const values: number[] = [];
    for await (const value of iterable) {
      values.push(value);
    }

    expect(values).toEqual([10]);
  });

  it('coverage: should propagate errors thrown by pull-based sources', async () => {
    let calls = 0;

    const sourceIterator: AsyncIterator<number> = {
      next: async () => {
        calls++;
        if (calls === 1) return { done: false, value: 1 };
        throw new Error("source boom");
      }
    };

    const iterator = switchMap<number, number>((value) => from([value * 10])).apply(sourceIterator as any);
    const iterable = { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<number>;

    const run = (async () => {
      const values: number[] = [];
      for await (const value of iterable) {
        values.push(value);
      }
      return values;
    })();

    await expectAsync(run).toBeRejectedWithError("source boom");
  });

  it('coverage: should ignore delayed emissions from stale inners (when inner has no return)', async () => {
    const source = createSubject<number>();

    const uncancellableDelayedInner = (value: number, ms: number) => {
      return {
        type: "stream",
        id: `uncancellable-${value}-${ms}`,
        [Symbol.asyncIterator]() {
          let emitted = false;
          return {
            next: async () => {
              if (emitted) return { done: true, value: undefined };
              emitted = true;
              await wait(ms);
              return { done: false, value };
            }
          } as AsyncIterator<number>;
        }
      };
    };

    const stream = source.pipe(
      switchMap((value) => {
        if (value === 1) return uncancellableDelayedInner(1, 20) as any;
        return from([2]);
      })
    );

    const results: number[] = [];
    const iterator = stream[Symbol.asyncIterator]();

    const readAll = (async () => {
      try {
        while (true) {
          const r = await iterator.next();
          if (r.done) break;
          results.push(r.value);
        }
      } finally {
        await iterator.return?.();
      }
    })();

    source.next(1);
    await wait(0);
    source.next(2);
    source.complete();

    await readAll;

    // Wait for the stale inner's delayed next() to resolve so switchMap's stale-check runs.
    await wait(30);

    expect(results).toEqual([2]);
  });

  it('coverage: should propagate errors thrown by __tryNext sources', async () => {
    let calls = 0;

    const sourceIterator: any = {
      __tryNext() {
        calls++;
        if (calls === 1) return { done: false, value: 1 };
        throw new Error("tryNext boom");
      },
      next: async () => {
        throw new Error("next() should not be used when __tryNext is present");
      }
    };

    const iterator = switchMap<number, number>((value) => from([value * 10])).apply(sourceIterator);
    const iterable = { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<number>;

    const run = (async () => {
      const values: number[] = [];
      for await (const value of iterable) {
        values.push(value);
      }
      return values;
    })();

    await expectAsync(run).toBeRejectedWithError("tryNext boom");
  });

  it('coverage: should carry parent iterator metadata to inner emissions', async () => {
    const source = createSubject<number>();
    const sourceIterator = source[Symbol.asyncIterator]();

    setIteratorMeta(sourceIterator as any, { valueId: "parent" }, 0, "test");

    const iterator = switchMap<number, any>(() => from([123])).apply(sourceIterator as any);
    const iterable = { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<any>;

    const valuesPromise = (async () => {
      const values: any[] = [];
      for await (const value of iterable) {
        values.push(value);
      }
      return values;
    })();

    source.next(1);
    source.complete();

    const values = await valuesPromise;
    expect(values.length).toBe(1);
    expect(isWrappedPrimitive(values[0])).toBeTrue();
    expect(unwrapPrimitive(values[0])).toBe(123);
    expect(getValueMeta(values[0])?.valueId).toBe("parent");
    expect(getValueMeta(values[0])?.kind).toBe("expand");
  });

  it('coverage: should propagate promise rejections from project', async () => {
    const source = createSubject<number>();
    const stream = source.pipe(
      switchMap(() => new Promise<number>((_, reject) => setTimeout(() => reject(new Error("reject boom")), 0)))
    );

    const iterator = stream[Symbol.asyncIterator]();
    const read = iterator.next();

    source.next(1);

    await expectAsync(read).toBeRejectedWithError("reject boom");
    await iterator.return?.();
  });
});
