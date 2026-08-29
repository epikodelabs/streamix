import { from, throwError } from '@epikodelabs/streamix';

describe('throwError', () => {
  it('should emit an error with the given message when subscribed', (done) => {
    const stream = from([1, 2, 3]).pipe(throwError('Boom!'));

    stream.subscribe({
      next: () => {
        fail('Expected no values to be emitted');
      },
      error: (err) => {
        expect(err).toEqual(jasmine.any(Error));
        expect(err.message).toBe('Boom!');
        done();
      }
    });
  });

  it('should error immediately even if the source is empty', (done) => {
    const stream = from([]).pipe(throwError('Never thrown'));

    stream.subscribe({
      next: () => {
        fail('Expected no values to be emitted');
      },
      error: (err) => {
        expect(err).toEqual(jasmine.any(Error));
        expect(err.message).toBe('Never thrown');
        done();
      }
    });
  });

  it('should not consume the source before throwing', async () => {
    const seen: number[] = [];

    async function* source() {
      seen.push(1);
      yield 1;
    }

    const iterator = from(source()).pipe(throwError('Boom!'))[Symbol.asyncIterator]();
    await expectAsync(iterator.next()).toBeRejectedWithError('Boom!');
    expect(seen).toEqual([]);
  });
});


