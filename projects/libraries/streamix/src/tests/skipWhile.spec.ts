import { from, skipWhile } from '@epikodelabs/streamix';

describe('skipWhile', () => {
  it('should skip values while the predicate is true', (done) => {
    const source$ = from([1, 2, 3, 4, 5]);
    const result: number[] = [];

    source$.pipe(skipWhile(val => val < 3)).subscribe({
      next: val => result.push(val),
      complete: () => {
        expect(result).toEqual([3, 4, 5]);
        done();
      },
      error: done.fail
    });
  });

  it('should emit all values if predicate is false initially', (done) => {
    const source$ = from([3, 4, 5]);
    const result: number[] = [];

    source$.pipe(skipWhile(val => val < 3)).subscribe({
      next: val => result.push(val),
      complete: () => {
        expect(result).toEqual([3, 4, 5]);
        done();
      },
      error: done.fail
    });
  });

  it('should skip all values if predicate is always true', (done) => {
    const source$ = from([1, 2, 3]);
    const result: number[] = [];

    source$.pipe(skipWhile(val => val < 10)).subscribe({
      next: val => result.push(val),
      complete: () => {
        expect(result).toEqual([]);
        done();
      },
      error: done.fail
    });
  });

  it('should support index parameter in predicate', (done) => {
    const source$ = from([10, 20, 30, 40, 50]);
    const result: number[] = [];
    const indices: number[] = [];

    source$.pipe(skipWhile((_, index) => {
      indices.push(index);
      return index < 2; // Skip first 2 values by index
    })).subscribe({
      next: val => result.push(val),
      complete: () => {
        expect(result).toEqual([30, 40, 50]);
        expect(indices).toEqual([0, 1, 2]);
        done();
      },
      error: done.fail
    });
  });

  it('should use index to skip based on position not value', (done) => {
    const source$ = from([100, 100, 100, 100]);
    const result: number[] = [];

    source$.pipe(skipWhile((_, index) => index < 2)).subscribe({
      next: val => result.push(val),
      complete: () => {
        expect(result).toEqual([100, 100]);
        done();
      },
      error: done.fail
    });
  });
});


