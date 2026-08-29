import { from, take } from '@epikodelabs/streamix';

describe('take', () => {
  it('should take specified number of emissions', (done) => {
    const testStream = from([1, 2, 3, 4, 5]);
    const count = 3;

    const takenStream = testStream.pipe(take(count));

    let results: any[] = [];

    takenStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([1, 2, 3]); // Should emit only the first three values
        done();
      }
    });
  });

  it('should handle case where count is greater than number of emissions', (done) => {
    const testStream = from([1, 2]);
    const count = 5;

    const takenStream = testStream.pipe(take(count));

    let results: any[] = [];

    takenStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([1, 2]); // Should emit all values because count is greater than number of emissions
        done();
      }
    });
  });

  it('should handle empty stream', (done) => {
    const testStream = from([]);
    const count = 3;

    const takenStream = testStream.pipe(take(count));

    let results: any[] = [];

    takenStream.subscribe({
      next: (value) => results.push(value),
      complete: () => {
        expect(results).toEqual([]); // Should emit no values because the stream is empty
        done();
      }
    });
  });

  it('should stop without pulling an extra source value once the limit is reached', async () => {
    const seen: number[] = [];

    async function* source() {
      seen.push(1);
      yield 1;
      seen.push(2);
      yield 2;
      seen.push(3);
      yield 3;
    }

    const values: number[] = [];
    for await (const value of from(source()).pipe(take(2))) {
      values.push(value);
    }

    expect(values).toEqual([1, 2]);
    expect(seen).toEqual([1, 2]);
  });
});


