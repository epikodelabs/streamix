import { createAsyncPushable, EMPTY, firstValueFrom, flow, from, iterate, lastValueFrom } from '@epikodelabs/streamix';

describe('eachValueFrom', () => {
  it('should get first value from the stream', async () => {
    const first = await firstValueFrom(from([1, 2, 3]));
    expect(first).toBe(1);
  });

  it('should get last value from the stream', async () => {
    const last = await lastValueFrom(from([1, 2, 3]));
    expect(last).toBe(3);
  });

  it('should throw an error if the source fails before completion for lastValueFrom', async () => {
    const source = createAsyncPushable<number>();
    const expectedError = new Error('Source failed unexpectedly');

    const promise = lastValueFrom(source);

    source.push(10);
    source.push(20);
    source.fail(expectedError);

    let caught: Error | undefined;
    try {
      await promise;
    } catch (err) {
      caught = err as Error;
    }

    expect(caught).toBe(expectedError);
  });

  it('should get each value emitted from the stream', async () => {
    const emittedValues: number[] = [];
    for await (const value of iterate(from([1, 2, 3]))) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual([1, 2, 3]);
  });

  it('should handle an empty source', async () => {
    let firstMessage: string | undefined;
    try {
      await firstValueFrom(EMPTY);
    } catch (error: any) {
      firstMessage = error.message;
    }
    expect(firstMessage).toBe('Source completed without emitting a value');

    let lastMessage: string | undefined;
    try {
      await lastValueFrom(EMPTY);
    } catch (error: any) {
      lastMessage = error.message;
    }
    expect(lastMessage).toBe('Source completed without emitting a value');

    const emittedValues: any[] = [];
    for await (const value of iterate(EMPTY)) {
      emittedValues.push(value);
    }
    expect(emittedValues).toEqual([]);
  });

  it('should throw if the stream errors during iteration', async () => {
    const expectedError = new Error('boom');
    const source = createAsyncPushable<number>();

    const values: number[] = [];
    const finished = (async () => {
      try {
        for await (const value of iterate(source)) {
          values.push(value);
        }
      } catch (err) {
        return err;
      }
      return undefined;
    })();

    source.push(1);
    source.fail(expectedError);
    const caught = await finished;

    expect(values).toEqual([1]);
    expect(caught).toBe(expectedError);
  });

  it('should not treat undefined as completion', async () => {
    const atom = flow<number | undefined>(async function* () {
      yield undefined;
    });

    const values: Array<number | undefined> = [];
    for await (const value of iterate(atom)) {
      values.push(value);
    }

    expect(values).toEqual([undefined]);
  });

  it('should return an async-iterable iterator (Symbol.asyncIterator returns itself)', async () => {
    const iterator = iterate(from([1]));
    expect(iterator[Symbol.asyncIterator]()).toBe(iterator);

    const values: number[] = [];
    for await (const v of iterator) values.push(v);
    expect(values).toEqual([1]);
  });

  it('should abort the underlying stream when iteration ends early', async () => {
    let capturedSignal: AbortSignal | undefined;
    let generatorFinallyRan = false;

    const atom = flow<number>(async function* (signal?: AbortSignal) {
      capturedSignal = signal;
      try {
        yield 1;
        if (signal?.aborted) return;
        await new Promise<void>(resolve =>
          signal?.addEventListener('abort', () => resolve(), { once: true })
        );
      } finally {
        generatorFinallyRan = true;
      }
    });

    const values: number[] = [];
    for await (const value of iterate(atom)) {
      values.push(value);
      break;
    }

    expect(values).toEqual([1]);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBeTrue();
    expect(generatorFinallyRan).toBeTrue();
  });
});
