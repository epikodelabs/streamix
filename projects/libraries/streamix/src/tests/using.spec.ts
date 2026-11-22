import { atom, DONE, handoff, iterate, pipe, using } from '@epikodelabs/streamix';

describe('using', () => {
  it('starts lazily and closes the child before the owner on completion', async () => {
    const events: string[] = [];
    const source = using({
      acquire: () => { events.push('open'); return 1; },
      stream: async function* (resource) {
        try { yield resource; }
        finally { events.push('child'); }
      },
      dispose: () => { events.push('owner'); },
    });
    expect(events).toEqual([]);

    const values: number[] = [];
    for await (const value of iterate(source)) values.push(value);
    expect(values).toEqual([1]);
    expect(events).toEqual(['open', 'child', 'owner']);
  });

  it('shares the active session and closes a late acquisition exactly once', async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const acquisition = Promise.withResolvers<number>();
    const acquire = jasmine.createSpy('acquire').and.callFake((signal: AbortSignal) => {
      started.resolve(signal);
      return acquisition.promise;
    });
    const dispose = jasmine.createSpy('dispose');
    const stream = jasmine.createSpy('stream');
    const source = using<number, number>({ acquire, stream, dispose });
    const first = source.subscribe();
    const second = source.subscribe();
    const signal = await started.promise;
    const value = source[Symbol.asyncIterator]();

    await first();
    await value.return?.();
    expect(signal.aborted).toBeFalse();
    const closing = second();
    expect(signal.aborted).toBeTrue();
    expect(dispose).not.toHaveBeenCalled();
    acquisition.resolve(17);
    await closing;
    await second();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnceWith(17);
  });

  for (const stage of ['prepare', 'ready'] as const) {
    it(`waits for handoff cleanup before closing the owner during ${stage}`, async () => {
      const selected = atom(1);
      const entered = Promise.withResolvers<AbortSignal>();
      const aborted = Promise.withResolvers<void>();
      const finishStage = Promise.withResolvers<void>();
      const disposingPlayer = Promise.withResolvers<void>();
      const finishPlayer = Promise.withResolvers<void>();
      const disposeOwner = jasmine.createSpy('disposeOwner');
      const block = (signal: AbortSignal) => {
        signal.addEventListener('abort', () => aborted.resolve(), { once: true });
        entered.resolve(signal);
        return finishStage.promise;
      };
      const source = using({
        acquire: () => 'session',
        stream: () => pipe(selected, handoff<number, number>({
          prepare: async (value, signal) => {
            if (stage === 'prepare') await block(signal);
            return value;
          },
          ready: (_player, signal) => stage === 'ready' ? block(signal) : undefined,
          dispose: async () => { disposingPlayer.resolve(); await finishPlayer.promise; },
        })),
        dispose: disposeOwner,
      });
      const unsubscribe = source.subscribe();
      const signal = await entered.promise;
      const closing = unsubscribe();
      await aborted.promise;
      expect(signal.aborted).toBeTrue();
      finishStage.resolve();
      await disposingPlayer.promise;
      expect(disposeOwner).not.toHaveBeenCalled();

      finishPlayer.resolve();
      await closing;
      expect(disposeOwner).toHaveBeenCalledOnceWith('session');
      await selected.dispose();
    });
  }

  it('can wait for a superseded handoff resource on natural completion', async () => {
    const selected = atom(1);
    const started = Promise.withResolvers<void>();
    const stale = Promise.withResolvers<number>();
    const delivered = Promise.withResolvers<void>();
    const events: string[] = [];
    const source = using({
      acquire: () => 'session',
      stream: () => pipe(selected, handoff<number, number>({
        awaitSupersededOnCompletion: true,
        prepare: value => {
          if (value !== 1) return value;
          started.resolve();
          return stale.promise;
        },
        ready: () => {},
        dispose: resource => { events.push(`player ${resource}`); },
      })),
      dispose: () => { events.push('owner'); },
    });
    const subscribe = source.subscribe(() => delivered.resolve());
    await started.promise;
    selected.next(2);
    await delivered.promise;
    const iterator = iterate(source);
    expect((await iterator.next()).value).toBe(2);
    const completion = iterator.next();
    await selected.dispose();
    expect(events).not.toContain('owner');

    stale.resolve(1);
    expect(await completion).toEqual(DONE);
    expect(events).toEqual(['player 2', 'player 1', 'owner']);
    await subscribe();
  });

  it('reconnects after cancellation and propagates cleanup-only failures to the last consumer', async () => {
    const failure = new Error('cleanup failed');
    const acquire = jasmine.createSpy('acquire').and.returnValue(1);
    const source = using<number, number>({
      acquire,
      stream: () => ({ [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => {}),
        return: async () => { throw failure; },
      }) }),
      dispose: () => {},
    });
    for (let i = 0; i < 2; i++) {
      const reader = source[Symbol.asyncIterator]();
      const read = reader.next();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const reading = expectAsync(read).toBeRejectedWithError('Iterator returned');
      await expectAsync(reader.return!()).toBeRejectedWith(failure);
      await reading;
      expect(await reader.next()).toEqual(DONE);
    }
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it('closes the session on setup failure and keeps that failure as the aggregate cause', async () => {
    const failure = new Error('setup failed');
    const cleanup = new Error('cleanup failed');
    const source = using<number, number>({
      acquire: () => 1,
      stream: () => { throw failure; },
      dispose: () => { throw cleanup; },
    });
    const read = source[Symbol.asyncIterator]().next();
    await expectAsync(read).toBeRejectedWith(jasmine.objectContaining({
      cause: failure,
      errors: [failure, cleanup],
    }));
  });
});
