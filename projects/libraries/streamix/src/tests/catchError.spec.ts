import { catchError, atom, fromAtom, map, NEXT, type Atom, type Stream } from '@epikodelabs/streamix';

describe('catchError', () => {
  let source$: Atom;
  let source: Stream;
  let handlerMock: jasmine.Spy;

  beforeEach(() => {
    handlerMock = jasmine.createSpy('handlerMock').and.returnValue(Promise.resolve(undefined)); // Mock handler function
  });

  it('should handle errors from a stream and not propagate them', (done) => {
    source$ = atom();
    source = fromAtom(source$);
    const error = new Error("Unhandled exception.");
    let errorCalled = false;

    const streamWithCatchError = source
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

    source$.set(1);
    source$.dispose();
  });

  it('should propagate errors if catchError is not present', (done) => {
    source$ = atom();
    source = fromAtom(source$);
    const error = new Error("Unhandled exception.");

    const streamWithoutCatchError = source.pipe(map(() => { throw error; }));

    streamWithoutCatchError.subscribe({
      error: (err) => {
        expect(err).toBe(error);
        expect(handlerMock).not.toHaveBeenCalled();
        done();
      }
    });

    source$.set(1);
    source$.dispose();
  });

  it('should complete after catching the first error', async () => {
    const error = new Error('Unhandled exception.');
    source$ = atom<number>();
    source = fromAtom(source$);
    const streamWithCatchError = source.pipe(
      map((value) => {
        if (value === 2) {
          throw error;
        }

        return value;
      }),
      catchError(handlerMock)
    );
    const streamIterator = streamWithCatchError[Symbol.asyncIterator]();

    source$.set(1);
    expect(await streamIterator.next()).toEqual(NEXT(1));

    source$.set(2);
    const result = await streamIterator.next();

    expect(result.done).toBeTrue();
    expect(result.value).toBeUndefined();
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledWith(error);

    expect(await streamIterator.next()).toEqual({ done: true, value: undefined });
  });

  it('should not trigger exception when catchError handles error from subject.error', async () => {
    const error = new Error('Subject error.');
    source$ = atom<number>();
    source = fromAtom(source$);
    const streamWithCatchError = source.pipe(
      catchError(handlerMock)
    );
    const streamIterator = streamWithCatchError[Symbol.asyncIterator]();

    source$.set(1);
    expect(await streamIterator.next()).toEqual(NEXT(1));

    source$.setError(error);
    const result = await streamIterator.next();

    expect(result.done).toBeTrue();
    expect(result.value).toBeUndefined();
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledWith(error);
  });

  it('should not call subscriber error callback when catchError handles subject.error', (done) => {
    const error = new Error('Subject error.');
    source$ = atom<number>();
    source = fromAtom(source$);
    let errorCalled = false;

    const streamWithCatchError = source.pipe(
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

    source$.set(1);
    source$.setError(error);
  });
});
