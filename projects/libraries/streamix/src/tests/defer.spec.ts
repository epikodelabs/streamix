import { createSubject, defer, from, type Stream } from '@epikodelabs/streamix';

// Mocking Stream class
/**
 * Function mockStream.
 */
export function mockStream(values: any[], completed = false, error?: Error): Stream<any> {
  const subject = createSubject<any>();

  setTimeout(() => {
    if (error) {
      subject.error(error);
      return;
    }

    values.forEach(value => subject.next(value));

    if (completed) {
      subject.complete();
    }
  }, 0);

  return subject;
}

describe('defer', () => {
  it('should create a new stream each time it is subscribed to', (done) => {
    const emissions: any[] = [1, 2, 3];
    const factory = jasmine.createSpy('factory').and.callFake(() => mockStream(emissions, true));

    const deferStream = defer(factory);

    const collectedEmissions: number[] = [];
    const subscription = deferStream.subscribe({
      next: (value: any) => collectedEmissions.push(value),
      complete: () => {
        expect(factory).toHaveBeenCalled();
        expect(collectedEmissions.length).toBe(3);
        expect(collectedEmissions).toEqual([1, 2, 3]);

        subscription.unsubscribe();
        done();
      },
      error: done.fail,
    });
  });

  it('should handle stream completion', (done) => {
    const factory = jasmine.createSpy('factory').and.callFake(() => mockStream([], true));

    const deferStream = defer(factory);

    deferStream.subscribe({
      complete: () => {
        expect(factory).toHaveBeenCalled();
        done();
      },
      error: done.fail,
    });
  });

  it('should handle stream errors', (done) => {
    const error = new Error('Test Error');
    const factory = jasmine.createSpy('factory').and.callFake(() => mockStream([], false, error));

    const deferStream = defer(factory);

    deferStream.subscribe({
      error: (e: Error) => {
        expect(e).toEqual(error);
      },
      complete: () => {
        done();
      },
      next: () => {
        fail('Should not emit');
      }
    });
  });

  it('supports promised factory results', async () => {
    const stream = defer(() => from(['defered', 'values']));
    const results: string[] = [];

    for await (const value of stream) {
      results.push(value);
    }

    expect(results).toEqual(['defered', 'values']);
  });

  it('supports factories that return promises resolving to streams', async () => {
    const factory = jasmine
      .createSpy('factory')
      .and.callFake(async () => from([10, 20]));

    const stream = defer(() => factory());
    const results: number[] = [];

    for await (const value of stream) {
      results.push(value);
    }

    expect(factory).toHaveBeenCalled();
    expect(results).toEqual([10, 20]);
  });

  it('throws when the factory promises reject', async () => {
    const err = new Error('factory failure');
    const stream = defer(() => Promise.reject(err));

    await new Promise<void>((resolve, reject) => {
      stream.subscribe({
        next: () => reject(new Error('should not emit')),
        error: (error) => {
          expect(error).toBe(err);
          resolve();
        },
        complete: () => reject(new Error('complete should not run')),
      });
    });
  });

  it('emits plain values returned by the factory immediately', async () => {
    const stream = defer(() => 42);
    const results: number[] = [];

    for await (const value of stream) {
      results.push(value);
    }

    expect(results).toEqual([42]);
  });
});


