import { catchError, createAsyncPushable, map, pipe, iterate } from '@epikodelabs/streamix';

describe('catchError', () => {
  let handlerMock: jasmine.Spy;

  beforeEach(() => {
    handlerMock = jasmine.createSpy('handlerMock').and.returnValue(Promise.resolve(undefined));
  });

  it('should handle errors from a stream and not propagate them', async () => {
    const source = createAsyncPushable<number>();
    const error = new Error("Unhandled exception.");

    const atom = pipe(
      source,
      map(() => { throw error; }),
      catchError(handlerMock)
    );

    const results: number[] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push(1);
    source.complete();
    await finished;

    expect(handlerMock).toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('should propagate errors if catchError is not present', async () => {
    const source = createAsyncPushable<number>();
    const error = new Error("Unhandled exception.");

    const atom = pipe(source, map(() => { throw error; }));

    source.push(1);
    source.complete();

    let caught: Error | undefined;
    try {
      for await (const _ of iterate(atom)) {
        // consume
      }
    } catch (err) {
      caught = err as Error;
    }

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(caught).toBe(error);
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it('should complete after catching the first error', async () => {
    const error = new Error('Unhandled exception.');
    const source = createAsyncPushable<number>();

    const atom = pipe(
      source,
      map((value) => {
        if (value === 2) {
          throw error;
        }
        return value;
      }),
      catchError(handlerMock)
    );

    const results: number[] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push(1);
    source.push(2);
    await finished;

    expect(results).toEqual([1]);
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledWith(error);
  });

  it('should not trigger exception when catchError handles source error', async () => {
    const error = new Error('Source error.');
    const source = createAsyncPushable<number>();

    const atom = pipe(source, catchError(handlerMock));

    const results: number[] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push(1);
    source.error(error);
    await finished;

    expect(results).toEqual([1]);
    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledWith(error);
  });

  it('should not call subscriber error callback when catchError handles source error', async () => {
    const error = new Error('Source error.');
    const source = createAsyncPushable<number>();

    const atom = pipe(source, catchError(handlerMock));

    const results: number[] = [];
    const finished = (async () => {
      for await (const value of iterate(atom)) {
        results.push(value);
      }
    })();

    source.push(1);
    source.error(error);
    await finished;

    expect(handlerMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([1]);
  });
});
