import { concatMap, createStream, createSubject, from, of, type Stream } from '@epikodelabs/streamix';

describe('concatMap', () => {

  let project: (value: any) => Stream;

  beforeEach(() => {
    // Replace with library-based stream function, e.g., `of` or `from`.
    project = (value: any) => of('innerValue' + value); // A simple stream projection
  });


  it('should handle errors in inner stream without affecting other emissions', (done) => {
    const values = ['1', '2'];
    const mockStream$ = from(values).pipe(concatMap((value: any) => (value === '2' ? errorInnerStream() : project(value))));

    const emittedValues: any[] = [];

    mockStream$.subscribe({
      next: (value: any) => emittedValues.push(value),
      error: (error: any) => {
        expect(emittedValues).toEqual(['innerValue1']);
        expect(error.message).toEqual('Inner Stream Error'); // Only second emission should throw
        done();
      },
      complete: () => done.fail('Stream completed unexpectedly'),
    });
  });

  it('should handle an empty stream', (done) => {
    const mockStream$ = from([]).pipe(concatMap(project));

    const emittedValues: any[] = [];
    mockStream$.subscribe({
      next: (value: any) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([]);
        done();
      }
    });
  });

  it('should project values and subscribe to inner stream in sequence', (done) => {
    const mockStream$ = from(['1', '2', '3', '4', '5']).pipe(concatMap(project));
    const emittedValues: any[] = [];

    mockStream$.subscribe({
      next: (value: any) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual(['innerValue1', 'innerValue2', 'innerValue3', 'innerValue4', 'innerValue5']);
        done();
      }
    });
  });

  it('should complete inner stream before processing next outer emission', (done) => {
    const emissions = ['1', '2', '3'];
    const mockStream$ = from(emissions).pipe(concatMap((value: any) => of(value)));

    const emittedValues: any[] = [];
    mockStream$.subscribe({
      next: (value: any) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual(emissions); // Sequential handling expected
        done();
      }
    });
  });

  it('should correctly concatenate emissions from both outer and inner streams', (done) => {
    const outerValues = ['outer1', 'outer2'];
    const innerValues1 = ['inner1a', 'inner1b'];
    const innerValues2 = ['inner2a', 'inner2b'];

    const projectFn = (value: any) => {
      return value === 'outer1' ? from(innerValues1) : from(innerValues2);
    };

    const mockStream$ = from(outerValues).pipe(concatMap(projectFn));
    const emittedValues: any[] = [];

    mockStream$.subscribe({
      next: (value: any) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual(['inner1a', 'inner1b', 'inner2a', 'inner2b']);
        done();
      }
    });
  });

  describe('edge cases', () => {
    it('should queue rapid successive emissions and process sequentially', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];
      const order: string[] = [];

      const concatenated = source.pipe(
        concatMap((val) => {
          order.push(`start-${val}`);
          const inner = createSubject<number>();
          setTimeout(() => {
            inner.next(val * 10);
            inner.complete();
            order.push(`end-${val}`);
          }, (4 - val) * 20); // Reverse timing
          return inner;
        })
      );

      concatenated.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([10, 20, 30]);
          // Should process in order despite timing
          expect(order).toEqual([
            'start-1', 'end-1',
            'start-2', 'end-2',
            'start-3', 'end-3'
          ]);
          done();
        }
      });

      source.next(1);
      source.next(2);
      source.next(3);
      source.complete();
    });

    it('should handle mix of sync and async inners in order', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const concatenated = source.pipe(
        concatMap((val) => {
          if (val % 2 === 0) {
            // Async
            return new Promise<number>((resolve) => {
              setTimeout(() => resolve(val * 10), 50);
            });
          }
          // Sync
          return of(val * 10);
        })
      );

      concatenated.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([10, 20, 30, 40]);
          done();
        }
      });

      source.next(1); // sync
      source.next(2); // async
      source.next(3); // sync
      source.next(4); // async
      source.complete();
    });

    it('should handle rapid emissions with empty inners', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const concatenated = source.pipe(
        concatMap((val) => {
          if (val === 2) {
            return from([]); // empty
          }
          return of(val * 10);
        })
      );

      concatenated.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([10, 30]);
          done();
        }
      });

      source.next(1);
      source.next(2); // empty
      source.next(3);
      source.complete();
    });

    it('should stop on first inner error in rapid emissions', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const concatenated = source.pipe(
        concatMap((val) => {
          const inner = createSubject<number>();
          setTimeout(() => {
            if (val === 2) {
              inner.error(new Error('Error at 2'));
            } else {
              inner.next(val * 10);
              inner.complete();
            }
          }, 20);
          return inner;
        })
      );

      concatenated.subscribe({
        next: (val) => results.push(val),
        error: (err) => {
          expect(err.message).toBe('Error at 2');
          expect(results).toEqual([10]);
          done();
        }
      });

      source.next(1);
      source.next(2);
      source.next(3); // Should never process
      source.complete();
    });
  });
});

// Error Handling Stream using library's `of` for simplicity
/**
 * Function errorInnerStream.
 */
export function errorInnerStream(): Stream {
  return createStream('errorInnerStream', async function *(this: Stream) {
    throw new Error('Inner Stream Error');
  });
}


