import { createSubject, fork, from, of } from '@epikodelabs/streamix'; // Adjust the import path accordingly

describe('fork', () => {
  let source$: any;
  let options: Array<{ on: (value: number) => boolean; handler: any }>;

  beforeEach(() => {
    // Create mock streams using `createStream`
    options = [
      { on: (value: number) => value <= 5, handler: () => of('Small number') },
      { on: (value: number) => value > 5 && value <= 15, handler: () => of('Medium number') },
      { on: (value: number) => value > 15, handler: () => of('Large number') },
    ];
  });

  it('should handle multiple emissions and match the correct stream', (done) => {
    const result: string[] = [];

    source$ = from([1, 5, 10, 20]).pipe(fork(...options));

    source$.subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        expect(result).toEqual(['Small number', 'Small number', 'Medium number', 'Large number']);
        done();
      }
    });
  });

  it('should match the correct stream based on conditions', (done) => {
    const result: string[] = [];

    const source$ = from([1, 10, 20]).pipe(fork(...options));

    source$.subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        // Test each value matches the correct case
        expect(result[0]).toBe('Small number');
        expect(result[1]).toBe('Medium number');
        expect(result[2]).toBe('Large number');
        done();
      }
    });
  });

  it('should return an error if no case matches', (done) => {
    const result: string[] = [];
    const invalidOptions = [
      { on: (value: number) => value === 100, handler: () => of('Invalid number') },
    ];

    const source$ = from([1, 5, 10, 20]).pipe(fork(...invalidOptions)); // Emissions: 1, 5, 10, 20

    source$.subscribe({
      next: (value: any) => result.push(value),
      error: (error: any) => {
        expect(error.message).toBe('No handler found for value: 1');
        done();
      }
    });
  });

  it('should handle a custom stream correctly for each case', (done) => {
    const result: string[] = [];
    const customStream = () => of('Custom stream result');

    options = [];
    // Adding a custom case to `options`
    options.push({
      on: (value: number) => value === 10,
      handler: customStream,
    });

    const source$ = of(10).pipe(fork(...options)); // Single emission: 10

    source$.subscribe({
      next: (value: any) => result.push(value),
      complete: () => {
        expect(result).toEqual(['Custom stream result']);
        done();
      }
    });
  });

  describe('edge cases', () => {
    it('should route rapid emissions based on predicates', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const forked = source.pipe(
        fork(
          {
            on: (val) => val === 1,
            handler: (val) => from([val * 10, val * 100])
          },
          {
            on: (val) => val === 2,
            handler: (val) => of(val * 10)
          },
          {
            on: (val) => val === 3,
            handler: (val) => [val * 10, val * 100]
          }
        )
      );

      forked.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([10, 100, 20, 30, 300]);
          done();
        }
      });

      source.next(1);
      source.next(2);
      source.next(3);
      source.complete();
    });

    it('should handle predicates with index parameter in rapid emissions', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const forked = source.pipe(
        fork(
          {
            on: (_, index) => index === 0,
            handler: (val) => from([val * 10, val * 100])
          },
          {
            on: (_, index) => index === 1,
            handler: (val) => of(val * 10)
          },
          {
            on: (_, index) => index === 2,
            handler: (val) => of(val * 10)
          }
        )
      );

      forked.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([10, 100, 20, 30]);
          done();
        }
      });

      source.next(1); // index 0
      source.next(2); // index 1
      source.next(3); // index 2
      source.complete();
    });

    it('should handle async predicates during rapid emissions', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const forked = source.pipe(
        fork(
          {
            on: async (val) => {
              await new Promise(resolve => setTimeout(resolve, 10));
              return val < 2;
            },
            handler: (val) => from([val * 10])
          },
          {
            on: async (val) => {
              await new Promise(resolve => setTimeout(resolve, 5));
              return val >= 2;
            },
            handler: (val) => of(val * 100)
          }
        )
      );

      forked.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([10, 200, 300]);
          done();
        }
      });

      source.next(1);
      source.next(2);
      source.next(3);
      source.complete();
    });

    it('should handle mixed handler types (stream, promise, array, scalar)', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const forked = source.pipe(
        fork(
          {
            on: (val) => val === 1,
            handler: (val) => from([val * 10]) // Stream
          },
          {
            on: (val) => val === 2,
            handler: (val) => new Promise<number>((resolve) =>
              setTimeout(() => resolve(val * 10), 10)
            ) // Promise
          },
          {
            on: (val) => val === 3,
            handler: (val) => [val * 10, val * 100] // Array
          },
          {
            on: (val) => val === 4,
            handler: (val) => val * 10 // Scalar
          }
        )
      );

      forked.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual([10, 20, 30, 300, 40]);
          done();
        }
      });

      source.next(1);
      source.next(2);
      source.next(3);
      source.next(4);
      source.complete();
    });

    it('should throw if no predicate matches', (done) => {
      const source = createSubject<number>();
      const results: number[] = [];

      const forked = source.pipe(
        fork(
          {
            on: (val) => val === 1,
            handler: (val) => of(val * 10)
          },
          {
            on: (val) => val === 2,
            handler: (val) => of(val * 10)
          }
        )
      );

      forked.subscribe({
        next: (val) => results.push(val),
        error: (err) => {
          expect(err).toBeDefined();
          expect(results).toEqual([10, 20]);
          done();
        }
      });

      source.next(1);
      source.next(2);
      source.next(3); // No matching predicate - should error
    });

    it('should handle sequential routing with rapid emissions', (done) => {
      const source = createSubject<string>();
      const results: string[] = [];

      const forked = source.pipe(
        fork(
          {
            on: (val) => val.startsWith('a'),
            handler: (val) => of(`[A:${val}]`)
          },
          {
            on: (val) => val.startsWith('b'),
            handler: (val) => of(`[B:${val}]`)
          },
          {
            on: () => true, // Catch-all
            handler: (val) => of(`[?:${val}]`)
          }
        )
      );

      forked.subscribe({
        next: (val) => results.push(val),
        complete: () => {
          expect(results).toEqual(['[A:apple]', '[B:banana]', '[?:cherry]']);
          done();
        }
      });

      source.next('apple');
      source.next('banana');
      source.next('cherry');
      source.complete();
    });
  });
});


