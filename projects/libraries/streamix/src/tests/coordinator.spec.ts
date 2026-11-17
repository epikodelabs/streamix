import {
  createAsyncCoordinator,
  DONE,
  getIterator,
  NEXT,
  raceNext,
  type SourceCapabilities,
  type SyncPoll,
} from '@epikodelabs/streamix';

/**
 * A push-driven source built directly on the source protocol: values are
 * produced synchronously by `pollSync` and new events are announced through
 * the registered readiness listener.
 */
function createPushSource<T>(): AsyncIterator<T> & {
  pollSync: () => SyncPoll<T>;
  onReady: (listener: () => void) => () => void;
  push: (value: T) => void;
} {
  const queue: T[] = [];
  let notify: (() => void) | undefined;

  const source: AsyncIterator<T> & {
    pollSync: () => SyncPoll<T>;
    onReady: (listener: () => void) => () => void;
    push: (value: T) => void;
  } = {
    pollSync: (): SyncPoll<T> => {
      if (queue.length === 0) {
        return { status: 'unavailable' };
      }

      return { status: 'available', result: NEXT(queue.shift()!) };
    },
    onReady: (listener: () => void) => {
      notify = listener;
      return () => {
        if (notify === listener) notify = undefined;
      };
    },
    push: (value: T) => {
      queue.push(value);
      notify?.();
    },
    next: async () => {
      throw new Error('next() should not be called when pollSync is present');
    },
    return: async () => DONE,
  };

  return source;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createAsyncCoordinator', () => {
  it('preserves FIFO demand when next is called inside a batch with buffered events', async () => {
    const source = createPushSource<number>();
    const coordinator = createAsyncCoordinator([source], { syncDrain: true });
    try {
      const first = coordinator.next();
      let second!: ReturnType<typeof coordinator.next>;
      coordinator.batch(() => {
        source.push(1);
        second = coordinator.next();
      });
      expect((await first).value).toEqual({ type: 'value', value: 1, sourceIndex: 0 });
      source.push(2);
      expect((await second).value).toEqual({ type: 'value', value: 2, sourceIndex: 0 });
    } finally {
      await coordinator.return!();
    }
  });

  it('reports unavailable from a batched pollSync when earlier waiters consume the buffer', async () => {
    const source = createPushSource<number>();
    const coordinator = createAsyncCoordinator([source], { syncDrain: true });
    try {
      const waiting = coordinator.next();
      coordinator.batch(() => {
        source.push(1);
        expect(coordinator.pollSync()).toEqual({ status: 'unavailable' });
      });
      expect((await waiting).value).toEqual({ type: 'value', value: 1, sourceIndex: 0 });
    } finally {
      await coordinator.return!();
    }
  });

  it('reuses naturally completed dynamic slots after their completion is consumed', async () => {
    const coordinator = createAsyncCoordinator<number>();
    try {
      for (let i = 0; i < 100; i++) {
        const source = { next: async () => DONE };
        expect(coordinator.addSource(source, i)).toBe(0);
        expect((await coordinator.next()).value).toEqual({ type: 'complete', sourceIndex: 0 });
        expect(coordinator.isSourceComplete(0)).toBe(true);
        // The coordinator must never grow protocol capabilities onto a plain
        // source: capability declaration stays with the adapter.
        expect('onReady' in source).toBeFalse();
        expect('pollSync' in source).toBeFalse();
      }
    } finally {
      await coordinator.return!();
    }
  });

  it('reserves naturally completed initial indices for fixed input identities', async () => {
    const coordinator = createAsyncCoordinator<number>([{ next: async () => DONE }]);
    try {
      expect((await coordinator.next()).value).toEqual({ type: 'complete', sourceIndex: 0 });
      expect(coordinator.addSource({ next: async () => DONE })).toBe(1);
      expect((await coordinator.next()).value).toEqual({ type: 'complete', sourceIndex: 1 });
      expect(coordinator.addSource({ next: async () => DONE })).toBe(1);
    } finally {
      await coordinator.return!();
    }
  });

  it('does not detach a replacement when an older waiter receives completion', async () => {
    let complete = false;
    let notify: (() => void) | undefined;
    const source = {
      pollSync: (): SyncPoll<number> => complete
        ? { status: 'available', result: DONE }
        : { status: 'unavailable' },
      onReady: (listener: () => void) => {
        notify = listener;
        return () => {
          if (notify === listener) notify = undefined;
        };
      },
      next: async () => DONE
    };
    const coordinator = createAsyncCoordinator<number>([source], { syncDrain: true });
    try {
      const old = coordinator.next();
      complete = true;
      notify!();
      // Replace synchronously after resolving the waiter, before its continuation.
      const removing = coordinator.removeSource(0);
      const replacement = createPushSource<number>();
      const index = coordinator.addSource(replacement);
      expect(index).toBe(0);
      await old;
      await removing;
      replacement.push(7);
      expect((await coordinator.next()).value).toEqual({ type: 'value', value: 7, sourceIndex: index });
    } finally {
      await coordinator.return!();
    }
  });

  it('unregisters its readiness listener when returned', async () => {
    const unregister = jasmine.createSpy('unregister');
    const onReady = jasmine.createSpy('onReady').and.returnValue(unregister);
    const source: AsyncIterator<number> & SourceCapabilities<number> = {
      next: async () => new Promise<IteratorResult<number>>(() => {}),
      return: async () => DONE,
      onReady,
    };

    const coordinator = createAsyncCoordinator([source]);

    expect(onReady).toHaveBeenCalled();
    await coordinator.return?.();
    expect(unregister).toHaveBeenCalled();
    // The source object stays untouched: no wrapped hook is left behind.
    expect((source as any).onReady).toBe(onReady);
  });

  it('unregisters its readiness listener when a source is removed', async () => {
    const unregister = jasmine.createSpy('unregister');
    const onReady = jasmine.createSpy('onReady').and.returnValue(unregister);
    const source: AsyncIterator<number> & SourceCapabilities<number> = {
      next: async () => new Promise<IteratorResult<number>>(() => {}),
      return: async () => DONE,
      onReady,
    };

    const coordinator = createAsyncCoordinator<number>();
    const index = coordinator.addSource(source);

    expect(onReady).toHaveBeenCalled();
    await coordinator.removeSource(index);
    expect(unregister).toHaveBeenCalled();

    await coordinator.return?.();
  });

  it('drains pushed values in source order via readiness notifications', () => {
    const source = createPushSource<number>();
    const coordinator = createAsyncCoordinator([source]);

    source.push(1);
    source.push(2);

    const firstEvent = { type: 'value' as const, value: 1, sourceIndex: 0 };
    const secondEvent = { type: 'value' as const, value: 2, sourceIndex: 0 };

    expect(coordinator.pollSync()).toEqual(
      { status: 'available', result: NEXT(firstEvent) }
    );
    expect(coordinator.pollSync()).toEqual(
      { status: 'available', result: NEXT(secondEvent) }
    );
  });

  it('converts a throwing pollSync into an error event and keeps draining', async () => {
    let shouldThrow = true;
    const source: AsyncIterator<number> & SourceCapabilities<number> = {
      pollSync: (): SyncPoll<number> => {
        if (shouldThrow) throw new Error('poll boom');
        return { status: 'available', result: DONE };
      },
      next: async () => DONE,
      return: async () => DONE,
    };
    const coordinator = createAsyncCoordinator([source]);

    const event = await coordinator.next();
    expect((event.value as any).type).toBe('error');
    expect((event.value as any).error.message).toBe('poll boom');

    shouldThrow = false;
    expect(coordinator.pollSync()).toEqual({ status: 'available', result: DONE });

    await coordinator.return?.();
  });

  it('swallows sync and async return errors during cleanup', async () => {
    const throwingSource: AsyncIterator<number> = {
      next: async () => DONE,
      return: () => {
        throw new Error('sync return boom');
      },
    };
    const rejectingSource: AsyncIterator<number> = {
      next: async () => DONE,
      return: async () => Promise.reject(new Error('async return boom')),
    };

    const coordinator = createAsyncCoordinator([throwingSource, rejectingSource]);

    await expectAsync(coordinator.return?.()).toBeResolvedTo(DONE);
  });

  it('reports unavailable while an async source is still pending and ignores late results from removed sources', async () => {
    const deferred = createDeferred<IteratorResult<number>>();
    let returned = false;
    const source: AsyncIterator<number> = {
      next: () => deferred.promise,
      return: async () => {
        returned = true;
        return DONE;
      },
    };

    const coordinator = createAsyncCoordinator([source], { syncDrain: true });

    expect(coordinator.pollSync()).toEqual({ status: 'unavailable' });
    expect(coordinator.hasBufferedEvents()).toBeFalse();
    expect(coordinator.isTerminal()).toBeFalse();

    await coordinator.removeSource(0);
    deferred.resolve(NEXT(1));
    await flush();

    expect(returned).toBeTrue();
    expect(coordinator.getActiveSourceCount()).toBe(0);
    expect(await coordinator.next()).toEqual(DONE);
  });

  it('falls back to async next when a synchronous fast path has no value yet', async () => {
    const deferred = createDeferred<IteratorResult<number>>();
    const source: AsyncIterator<number> & SourceCapabilities<number> = {
      pollSync: () => ({ status: 'unavailable' }),
      next: () => deferred.promise,
      return: async () => DONE,
    };

    const coordinator = createAsyncCoordinator([source], { syncDrain: true });
    const next = coordinator.next();

    deferred.resolve(NEXT(7));

    expect(await next).toEqual(
      NEXT({ type: 'value' as const, value: 7, sourceIndex: 0 })
    );

    await coordinator.return?.();
  });

  it('reports terminal state through the protocol probes for exhausted sources', async () => {
    const coordinator = createAsyncCoordinator<number>();

    await coordinator.removeSource(-1);
    await coordinator.removeSource(0);
    await coordinator.removeSourceByKey('missing');

    expect(coordinator.isTerminal()).toBeTrue();
    expect(coordinator.hasBufferedEvents()).toBeFalse();
    expect(coordinator.pollSync()).toEqual({ status: 'available', result: DONE });
    expect(coordinator.isSourceComplete(-1)).toBeTrue();
    expect(coordinator.isSourceComplete(0)).toBeTrue();
  });

  it('throws when adding a source after return', async () => {
    const coordinator = createAsyncCoordinator<number>();

    await coordinator.return?.();

    expect(() => coordinator.addSource({ next: async () => DONE })).toThrowError(
      'Cannot add source to returned coordinator'
    );
  });
});

describe('coordinator utils', () => {
  it('gets sync iterators and throws for non-iterables', () => {
    const iterable = {
      [Symbol.iterator]() {
        let done = false;
        return {
          next: () => {
            if (done) {
              return { done: true, value: undefined as number | undefined };
            }

            done = true;
            return { done: false, value: 1 };
          },
        };
      },
    };

    const iterator = getIterator(iterable);

    expect(iterator.next()).toEqual({ done: false, value: 1 });
    expect(() => getIterator({} as never)).toThrowError('Source is not iterable');
  });

  it('handles already-aborted and rejected next calls in raceNext', async () => {
    const aborted = new AbortController();
    aborted.abort();

    expect(await raceNext({ next: () => NEXT(1) }, aborted.signal)).toEqual({
      done: true,
      value: undefined,
    });

    const active = new AbortController();
    await expectAsync(
      raceNext(
        {
          next: () => Promise.reject(new Error('next boom')),
        },
        active.signal
      )
    ).toBeRejectedWithError('next boom');
  });
});
