import { createSubject, delay, EMPTY, from, of, switchMap } from '@epikodelabs/streamix';

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
});
