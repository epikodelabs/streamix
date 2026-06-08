import { catchError, createSubject, map, NEXT, type Subject } from '@epikodelabs/streamix';

describe('catchError', () => {
  let subject: Subject;
  let handlerMock: jasmine.Spy;

  beforeEach(() => {
    handlerMock = jasmine.createSpy('handlerMock').and.returnValue(Promise.resolve(undefined)); // Mock handler function
  });

  it('should handle errors from a stream and not propagate them', (done) => {
    subject = createSubject();
    const error = new Error("Unhandled exception.");
    let errorCalled = false;

    const streamWithCatchError = subject
      .pipe(
        map(() => { throw error; }),
        catchError(handlerMock)
      );

    streamWithCatchError.subscribe({
      error: () => { errorCalled = true; },
      complete: () => {
        expect(handlerMock).toHaveBeenCalled();
        expect(errorCalled).toBeFalse();
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
    expect(await streamIterator.next()).toEqual(NEXT(1));

    subject.next(2);
    const result = await streamIterator.next();

    expect(result.done).toBeTrue();
    expect(result.value).toBeUndefined();
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledWith(error);

    expect(await streamIterator.next()).toEqual({ done: true, value: undefined });
  });

  it('should not trigger exception when catchError handles error from subject.error', async () => {
    const error = new Error('Subject error.');
    subject = createSubject<number>();
    const streamWithCatchError = subject.pipe(
      catchError(handlerMock)
    );
    const streamIterator = streamWithCatchError[Symbol.asyncIterator]();

    subject.next(1);
    expect(await streamIterator.next()).toEqual(NEXT(1));

    subject.error(error);
    const result = await streamIterator.next();

    expect(result.done).toBeTrue();
    expect(result.value).toBeUndefined();
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledWith(error);
  });

  it('should not call subscriber error callback when catchError handles subject.error', (done) => {
    const error = new Error('Subject error.');
    subject = createSubject<number>();
    let errorCalled = false;

    const streamWithCatchError = subject.pipe(
      catchError(handlerMock)
    );

    streamWithCatchError.subscribe({
      error: () => { errorCalled = true; },
      complete: () => {
        expect(handlerMock).toHaveBeenCalledTimes(1);
        expect(errorCalled).toBeFalse();
        done();
      }
    });

    subject.next(1);
    subject.error(error);
  });
});
