import { createStream, createSubject, eachValueFrom, EMPTY, firstValueFrom, from, lastValueFrom } from '@epikodelabs/streamix';

describe('eachValueFrom', () => {
  it('should get first value from the stream', async () => {
    const first = await firstValueFrom(from([1, 2, 3]));

    expect(first).toBe(1); // The first emitted value should be 1
  });

  it('should get last value from the stream', async () => {
    const last = await lastValueFrom(from([1, 2, 3]));

    expect(last).toBe(3); // The last emitted value should be 3
  });
  
  it('should throw an error if the source stream fails before completion for lastValueFrom', async () => {
    const source$ = createSubject<number>();
    const expectedError = new Error('Source failed unexpectedly');

    // We use try/catch to assert that the promise returned by lastValueFrom is rejected
    try {
      // Start the asynchronous operation
      const promise = lastValueFrom(source$);

      // Emit some values, which should be ignored since the stream errors
      source$.next(10);
      source$.next(20);

      // Cause the stream to fail
      source$.error(expectedError);

      // Wait for the promise to settle
      await promise;

      // If it reaches here, the test fails because it completed instead of errored
      fail('lastValueFrom should have thrown an error, but completed successfully.');
    } catch (error: any) {
      // Assert that the error caught is the expected one
      expect(error).toBe(expectedError);
    }
  });

  it('should get each value emitted from the stream', async () => {
    // Using eachValueFrom
    const emittedValues = [];
    for await (const value of eachValueFrom(from([1, 2, 3]))) {
      emittedValues.push(value);
    }

    expect(emittedValues).toEqual([1, 2, 3]); // Should collect all emitted values
  });

  it('should handle an empty stream', async () => {

    try {
      // Using firstValueFrom
      await firstValueFrom(EMPTY);
    } catch (error: any) {
      expect(error.message).toBe("Stream completed without emitting a value"); // No value should be emitted
    }

    try {
      // Using lastValueFrom
      await lastValueFrom(EMPTY);
    } catch (error: any) {
      expect(error.message).toBe("Stream completed without emitting a value"); // No value should be emitted
    }

    // Using eachValueFrom
    const emittedValues = [];
    for await (const value of eachValueFrom(EMPTY)) {
      emittedValues.push(value);
    }
    expect(emittedValues).toEqual([]); // No values should be emitted
  });

  it('should throw if the stream errors during iteration', async () => {
    const expectedError = new Error('boom');
    const stream = createStream<number>('boom-stream', async function* () {
      yield 1;
      throw expectedError;
    });

    const values: number[] = [];
    try {
      for await (const value of eachValueFrom(stream)) {
        values.push(value);
      }
      fail('Expected iteration to throw');
    } catch (err) {
      expect(values).toEqual([1]);
      expect(err).toBe(expectedError);
    }
  });

  it('should not treat undefined as completion', async () => {
    const stream = createStream<number | undefined>('undefined-stream', async function* () {
      yield undefined;
    });

    const values: Array<number | undefined> = [];
    for await (const value of eachValueFrom(stream)) {
      values.push(value);
    }

    expect(values).toEqual([undefined]);
  });

  it('should return an async-iterable iterator (Symbol.asyncIterator returns itself)', async () => {
    const iterator = eachValueFrom(from([1]));
    expect(iterator[Symbol.asyncIterator]()).toBe(iterator);

    const values: number[] = [];
    for await (const v of iterator) values.push(v);
    expect(values).toEqual([1]);
  });

  it('should patch iterators that do not implement Symbol.asyncIterator', async () => {
    const rawIterator: AsyncIterator<number> = {
      next: async () => ({ done: false as const, value: 1 }),
    };

    const fakeStream = {
      type: "stream",
      id: "fake",
      pipe: () => { throw new Error("not needed"); },
      subscribe: () => { throw new Error("not needed"); },
      query: async () => { throw new Error("not needed"); },
      [Symbol.asyncIterator]: () => rawIterator,
    };

    const iterator = eachValueFrom(fakeStream as any);

    expect(typeof (iterator as any)[Symbol.asyncIterator]).toBe("function");
    expect(iterator[Symbol.asyncIterator]()).toBe(iterator);

    // Ensure iteration works using the patched async-iterable shape.
    const values: number[] = [];
    for await (const v of iterator) {
      values.push(v);
      break;
    }
    expect(values).toEqual([1]);
  });

  it('should abort the underlying stream when iteration ends early', async () => {
    let capturedSignal: AbortSignal | undefined;
    let generatorFinallyRan = false;

    const stream = createStream<number>('abortable', async function* (signal: AbortSignal) {
      capturedSignal = signal;
      try {
        yield 1;
        if (signal.aborted) return;
        await new Promise<void>(resolve =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      } finally {
        generatorFinallyRan = true;
      }
    });

    const values: number[] = [];
    for await (const value of eachValueFrom(stream)) {
      values.push(value);
      break;
    }

    expect(values).toEqual([1]);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBeTrue();
    expect(generatorFinallyRan).toBeTrue();
  });
});


