import { catchError, from, scan } from '@epikodelabs/streamix';

describe('scan', () => {
  it('should accumulate values correctly', (done) => {
    const testStream = from([1, 2, 3]);
    const accumulator = (acc: number, value: number) => acc + value;
    const seed = 0;

    const scannedStream = testStream.pipe(scan(accumulator, seed));

    let results: any[] = [];

    scannedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([1, 3, 6]);
        done();
      }
    });
  });

  it('should handle errors in accumulation', (done) => {
    const testStream = from([1, 2, 3]);
    const accumulator = (acc: number, value: number) => {
      if (value === 2) {
        throw new Error('Error in accumulation');
      }
      return acc + value;
    };
    const seed = 0;

    const scannedStream = testStream.pipe(scan(accumulator, seed), catchError());

    let results: any[] = [];

    scannedStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([1]); // Only the first value should be accumulated before error
        done();
      }
    });
  });

  it('should support promise-based accumulators', async () => {
    const testStream = from([1, 2, 3]);
    const accumulator = async (acc: number, value: number) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return acc + value;
    };
    const seed = 0;

    const results: number[] = [];
    for await (const value of testStream.pipe(scan(accumulator, seed))) {
      results.push(value);
    }

    expect(results).toEqual([1, 3, 6]);
  });
});


