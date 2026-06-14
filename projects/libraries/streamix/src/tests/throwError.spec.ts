import { from, iterate, pipe, throwError } from '@epikodelabs/streamix';

describe('throwError', () => {
  it('should emit an error when the source emits a value', async () => {
    const atom = pipe(from([1, 2, 3]), throwError('Boom!'));

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(atom)) {
        void _;
      }
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toEqual(jasmine.any(Error));
    expect(caught?.message).toBe('Boom!');
  });

  it('should complete without error if the source is empty', async () => {
    const atom = pipe(from([]), throwError('Never thrown'));

    const results: any[] = [];
    for await (const value of iterate(atom)) {
      results.push(value);
    }

    expect(results).toEqual([]);
  });
});
