import { atom, createAsyncPushable, DONE, EMPTY, firstValueFrom, flow, from, fromPush, iterate, lastValueFrom, NEXT, type PushSink } from '@epikodelabs/streamix';
import { asStreamixSource, type SyncPoll } from '../lib/utils/source-protocol';

describe('iterate', () => {
  it('removes finished iterators from the atom dispose handlers', async () => {
    const a = atom<number>();

    for (let i = 0; i < 5; i++) {
      const iterator = iterate(a)[Symbol.asyncIterator]();

      if (i === 0) {
        const first = iterator.next();
        a.next(i);
        expect((await first).value).toBe(i);
      } else {
        // Stateful iteration replays the current value first. Consume that
        // replay, then verify the iterator also observes the next write.
        expect((await iterator.next()).value).toBe(i - 1);
        const next = iterator.next();
        a.next(i);
        expect((await next).value).toBe(i);
      }

      await iterator.return?.();
    }

    expect((a as any)._onDispose.size).toBe(0);
  });

  it('yields an atom current value immediately when one exists', async () => {
    const source = atom(5);
    const iterator = iterate(source);

    expect(await iterator.next()).toEqual({ done: false, value: 5 });
    await iterator.return?.();
  });

  it('assigns replay and discrete emissions to overlapping pulls in call order', async () => {
    const source = atom(0);
    const iterator = iterate(source);
    const pulls = [iterator.next(), iterator.next(), iterator.next()];

    source.next(1);
    source.next(2);
    source.next(3);
    source.next(4);

    expect(await Promise.all(pulls)).toEqual([NEXT(0), NEXT(1), NEXT(2)]);
    expect(await iterator.next()).toEqual(NEXT(3));
    expect(await iterator.next()).toEqual(NEXT(4));
    await iterator.return?.();
  });

  it('keeps the initial pull first when producer startup reenters next()', async () => {
    let nested!: Promise<IteratorResult<number>>;
    const source = fromPush<number>(sink => {
      nested = iterator.next();
      void sink.next(1);
      void sink.next(2);
    });
    const iterator = iterate(source);

    const first = iterator.next();

    expect(await Promise.all([first, nested])).toEqual([NEXT(1), NEXT(2)]);
    await iterator.return?.();
  });

  it('conflates only emissions left over after satisfying waiting pulls', async () => {
    let sink!: PushSink<number>;
    const source = fromPush<number>(producer => { sink = producer; }, { mode: 'analog' });
    const iterator = asStreamixSource(iterate(source));
    const pulls = [iterator.next(), iterator.next()];

    for (const value of [1, 2, 3, 4]) {
      const delivered = new Promise<void>(resolve => {
        const stop = iterator.onReady!(() => { stop(); resolve(); });
      });
      await sink.next(value);
      await delivered;
    }

    expect(await Promise.all(pulls)).toEqual([NEXT(1), NEXT(2)]);
    expect(await iterator.next()).toEqual(NEXT(4));
    await iterator.return?.();
  });

  it('completes every outstanding pull when the producer ends', async () => {
    const iterator = iterate(flow([1]));
    const pulls = [iterator.next(), iterator.next(), iterator.next()];

    expect(await Promise.all(pulls)).toEqual([NEXT(1), DONE, DONE]);
    expect(await iterator.next()).toEqual(DONE);
  });

  it('notifies readiness and closes a never-started iterator without connecting', async () => {
    const connect = jasmine.createSpy('connect');
    const iterator = asStreamixSource(iterate(fromPush<number>(connect)));
    const ready = jasmine.createSpy('ready');
    const stop = iterator.onReady!(ready);

    expect(await iterator.return?.()).toEqual(DONE);
    expect(await iterator.next()).toEqual(DONE);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    stop();
  });

  for (const termination of ['return', 'disposal', 'failure'] as const) {
    it(`settles all waiting pulls and detaches the subscription on ${termination}`, async () => {
      const source = atom<number>();
      const iterator = iterate(source);
      const pulls = Promise.allSettled([iterator.next(), iterator.next()]);
      const error = new Error('source failed');

      if (termination === 'return') await iterator.return?.();
      else if (termination === 'disposal') source.dispose();
      else source.fail(error);

      const expected: PromiseSettledResult<IteratorResult<number>> = termination === 'failure'
        ? { status: 'rejected', reason: error }
        : { status: 'fulfilled', value: DONE };
      expect(await pulls).toEqual([expected, expected]);
      expect(await iterator.next()).toEqual(DONE);
      expect(source.subscriberCount).toBe(0);
      expect((source as any)._onDispose.size).toBe(0);
    });
  }

  it('drains accepted values before surfacing a buffered failure once', async () => {
    const source = atom<number>();
    const iterator = asStreamixSource(iterate(source));
    const error = new Error('source failed');

    expect(iterator.pollSync!()).toEqual({ status: 'unavailable' });
    source.next(1);
    source.next(2);
    source.fail(error);
    source.next(3);

    expect(iterator.isTerminal!()).toBeTrue();
    expect(iterator.pollSync!()).toEqual({ status: 'available', result: NEXT(1) });
    expect(await iterator.next()).toEqual(NEXT(2));
    expect(iterator.hasBufferedEvents!()).toBeTrue();
    expect(() => iterator.pollSync!()).toThrow(error);
    expect(iterator.hasBufferedEvents!()).toBeFalse();
    expect(await iterator.next()).toEqual(DONE);
  });

  it('prevents readiness polls from taking values assigned to waiting async pulls', async () => {
    const source = atom<number>();
    const iterator = asStreamixSource(iterate(source));
    const polls: SyncPoll<number>[] = [];
    const stop = iterator.onReady!(() => { polls.push(iterator.pollSync!()); });
    const pulls = [iterator.next(), iterator.next()];

    source.next(1);
    source.next(2);
    source.next(3);

    expect(await Promise.all(pulls)).toEqual([NEXT(1), NEXT(2)]);
    expect(polls).toEqual([
      { status: 'unavailable' },
      { status: 'unavailable' },
      { status: 'available', result: NEXT(3) },
    ]);
    stop();
    await iterator.return?.();
  });

  it('can suppress only the subscription replay for internal state bridges', async () => {
    const source = atom(1);
    const iterator = iterate(source, { replayCurrent: false });
    const next = iterator.next();

    source.next(2);

    expect(await next).toEqual({ done: false, value: 2 });
    await iterator.return?.();
  });

  it('releases atom dispose hooks when an iterator is returned early', async () => {
    const source = atom<number>();
    const iterator = iterate(source);

    const first = iterator.next();
    source.next(42);
    expect(await first).toEqual({ done: false, value: 42 });

    await iterator.return?.();
    expect((source as any)._onDispose.size).toBe(0);
  });

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
