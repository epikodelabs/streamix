import { catchError, from, map } from '@epikodelabs/streamix';

describe('map', () => {
  it('should transform values correctly', (done) => {
    const testStream = from([1, 2, 3]);
    const transform = (value: number) => value * 2;

    const mappedStream = testStream.pipe(map(transform));

    let results: any[] = [];

    mappedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([2, 4, 6]);
        done();
      }
    });
  });

  it('should handle errors in transformation', (done) => {
    const testStream = from([1, 2, 3]);
    const transform = (value: number) => {
      if (value === 2) {
        throw new Error('Error in transformation');
      }
      return value * 2;
    };

    const mappedStream = testStream.pipe(map(transform), catchError());

    let results: any[] = [];

    mappedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([2]); // Only the first value should be emitted before error
        done();
      }
    });
  });

  it('should handle promise-based transformations', (done) => {
    const testStream = from([1, 2, 3]);
    const transform = (value: number, index: number) =>
      Promise.resolve(value + index);

    const mappedStream = testStream.pipe(map(transform));

    const results: number[] = [];
    mappedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([1, 3, 5]);
        done();
      },
      error: done.fail,
    });
  });
});


