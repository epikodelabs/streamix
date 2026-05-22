import { catchError, createSubject, map, type Subject } from '@epikodelabs/streamix';

describe('catchError', () => {
  let subject: Subject;
  let handlerMock: jasmine.Spy;

  beforeEach(() => {
    handlerMock = jasmine.createSpy('handlerMock').and.returnValue(Promise.resolve(undefined)); // Mock handler function
  });

  it('should handle errors from a stream and not propagate them', (done) => {
    subject = createSubject();
    const error = new Error("Unhandled exception.");

    const streamWithCatchError = subject
      .pipe(
        map(() => { throw error; }),
        catchError(handlerMock)
      );

    streamWithCatchError.subscribe({
      next: value => console.log(value),
      complete: () => {
        expect(handlerMock).toHaveBeenCalled();
        done();
      }
    });

    subject.next(1);
    subject.complete();
  });

  it('should propagate errors if catchError is not present', (done) => {
    subject = createSubject();
    const error = new Error("Unhandled exception.");

    const streamWithoutCatchError = subject.pipe(map(() => { throw error; }));

    streamWithoutCatchError.subscribe({
      next: value => console.log(value),
      error: (err) => {
        expect(err).toBe(error);
        expect(handlerMock).not.toHaveBeenCalled();
        done();
      }
    });

    subject.next(1);
    subject.complete();
  });

  it('should complete after catching the first error', async () => {
    const error = new Error('Unhandled exception.');
    subject = createSubject<number>();
    const streamWithCatchError = subject.pipe(
      map((value) => {
        if (value === 2) {
          throw error;
        }

        return value;
      }),
      catchError(handlerMock)
    );
    const streamIterator = streamWithCatchError[Symbol.asyncIterator]();

    subject.next(1);
    expect(await streamIterator.next()).toEqual({ done: false, value: 1 });

    subject.next(2);
    const result = await streamIterator.next();

    expect(result.done).toBeTrue();
    expect(result.value).toBeUndefined();
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledWith(error);

    expect(await streamIterator.next()).toEqual({ done: true, value: undefined });
  });
});


