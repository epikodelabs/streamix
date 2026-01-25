import { from, takeWhile } from '@epikodelabs/streamix';

describe('takeWhile', () => {
  it('should take emissions while predicate returns true', (done) => {
    const testStream = from([1, 2, 3, 4, 5]);
    const predicate = (value: number) => value < 4;

    const takenWhileStream = testStream.pipe(takeWhile(predicate));

    let results: any[] = [];

    takenWhileStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([1, 2, 3]); // Should emit values until predicate returns false
        done();
      }
    });
  });

  it('should handle empty stream', (done) => {
    const testStream = from([]);
    const predicate = (_: any) => true; // Should never be called in an empty stream

    const takenWhileStream = testStream.pipe(takeWhile(predicate));

    let results: any[] = [];

    takenWhileStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([]); // Should not emit any values from an empty stream
        done();
      }
    });
  });

  it('should handle immediate false predicate', (done) => {
    const testStream = from([1, 2, 3]);
    const predicate = (value: number) => value > 3; // Predicate immediately returns false

    const takenWhileStream = testStream.pipe(takeWhile(predicate));

    let results: any[] = [];

    takenWhileStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([]); // Should not emit any values because predicate returns false immediately
        done();
      }
    });
  });

  it('should support index parameter in predicate', (done) => {
    const testStream = from([10, 20, 30, 40, 50]);
    const results: number[] = [];
    const indices: number[] = [];

    testStream.pipe(takeWhile((val, index) => {
      indices.push(index);
      return index < 2; // Take first 2 values by index
    })).subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([10, 20]);
        expect(indices).toEqual([0, 1, 2]); // Index 2 checked before predicate returns false
        done();
      }
    });
  });

  it('should use index to take based on position not value', (done) => {
    const testStream = from([100, 100, 100, 100, 100]);
    const results: number[] = [];

    testStream.pipe(takeWhile((_, index) => index < 3)).subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([100, 100, 100]);
        done();
      }
    });
  });
});


