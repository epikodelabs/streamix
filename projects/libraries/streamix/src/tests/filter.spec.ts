import { filter, from } from '@epikodelabs/streamix';

describe('filter', () => {
  it('should allow values that pass the predicate', (done) => {
    const testStream = from([1, 2, 3, 4, 5]);
    const predicate = (value: number) => value % 2 === 0;

    const filteredStream = testStream.pipe(filter(predicate));

    filteredStream.subscribe({
      next: (value) => {
        expect(value).toBeGreaterThanOrEqual(2);
      },
      complete: () => {
        done();
      },
      error: done.fail,
    });
  });

  it('should not emit values that fail the predicate', (done) => {
    const testStream = from([1, 2, 3]);
    const predicate = (value: number) => value > 3;

    const filteredStream = testStream.pipe(filter(predicate));
    let emittedCount = 0;

    filteredStream.subscribe({
      next: (value) => {
        emittedCount++;
        fail(`Unexpected value emitted: ${value}`);
      },
      complete: () => {
        expect(emittedCount).toBe(0);
        done();
      },
      error: done.fail,
    });
  });

  it('should emit all allowed values before stopping', (done) => {
    const testStream = from([1, 2, 3, 4, 5]);
    const predicate = (value: number) => value <= 3;

    let count = 0;

    const filteredStream = testStream.pipe(filter(predicate));

    filteredStream.subscribe({
      next: () => count++,
      complete: () => {
        expect(count).toBe(3);
        done();
      },
      error: done.fail,
    });
  });

  it('should support async predicates', (done) => {
    const testStream = from([1, 2, 3]);
    const predicate = async (value: number) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return value % 2 === 1;
    };

    const filteredStream = testStream.pipe(filter(predicate));
    const values: number[] = [];

    filteredStream.subscribe({
      next: (value) => values.push(value),
      complete: () => {
        expect(values).toEqual([1, 3]);
        done();
      },
      error: done.fail,
    });
  });

  it('should allow filtering by array of values', (done) => {
    const testStream = from([1, 2, 3, 4, 5]);

    const filteredStream = testStream.pipe(filter([2, 4]));
    const values: number[] = [];

    filteredStream.subscribe({
      next: (value) => values.push(value),
      complete: () => {
        expect(values).toEqual([2, 4]);
        done();
      },
      error: done.fail,
    });
  });

  it('should allow filtering by single value', (done) => {
    const testStream = from([1, 2, 3]);

    const filteredStream = testStream.pipe(filter(2));
    const values: number[] = [];

    filteredStream.subscribe({
      next: (value) => values.push(value),
      complete: () => {
        expect(values).toEqual([2]);
        done();
      },
      error: done.fail,
    });
  });
});
