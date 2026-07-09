import {
  createAsyncCoordinator,
  DONE,
  getIterator,
  NEXT,
  raceNext,
} from '@epikodelabs/streamix';

function createPushSource<T>(onPush?: () => void): AsyncIterator<T> & {
  __onPush?: () => void;
  __tryNext: () => IteratorResult<T> | null;
  push: (value: T) => void;
} {
  const queue: T[] = [];

  const source: AsyncIterator<T> & {
    __onPush?: () => void;
    __tryNext: () => IteratorResult<T> | null;
    push: (value: T) => void;
  } = {
    __onPush: onPush,
    __tryNext: () => {
      if (queue.length === 0) {
        return null;
      }

      return NEXT(queue.shift()!);
    },
    push: (value: T) => {
      queue.push(value);
      source.__onPush?.();
    },
    next: async () => {
      throw new Error('next() should not be called when __tryNext is present');
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
  it('restores source push handlers when returned', async () => {
    const originalOnPush = () => {};
    const source: AsyncIterator<number> & { __onPush?: () => void } = {
      __onPush: originalOnPush,
      next: async () => new Promise<IteratorResult<number>>(() => {}),
      return: async () => DONE,
    };

    const coordinator = createAsyncCoordinator([source]);

    expect(source.__onPush).not.toBe(originalOnPush);
    await coordinator.return?.();
    expect(source.__onPush).toBe(originalOnPush);
  });

  it('restores source push handlers when a source is removed', async () => {
    const originalOnPush = () => {};
    const source: AsyncIterator<number> & { __onPush?: () => void } = {
      __onPush: originalOnPush,
      next: async () => new Promise<IteratorResult<number>>(() => {}),
      return: async () => DONE,
    };

    const coordinator = createAsyncCoordinator<number>();
    const index = coordinator.addSource(source);

    expect(source.__onPush).not.toBe(originalOnPush);
    await coordinator.removeSource(index);
    expect(source.__onPush).toBe(originalOnPush);

    await coordinator.return?.();
  });

  it('drains pushed values in source order via __onPush', () => {
    const source = createPushSource<number>();
    const coordinator = createAsyncCoordinator([source]);

    source.push(1);
    source.push(2);

    const firstEvent = { type: 'value' as const, value: 1, sourceIndex: 0 };
    const secondEvent = { type: 'value' as const, value: 2, sourceIndex: 0 };

    expect(coordinator.__tryNext?.()).toEqual(
      NEXT(firstEvent)
    );
    expect(coordinator.__tryNext?.()).toEqual(
      NEXT(secondEvent)
    );
  });

  it('continues draining when an original __onPush hook throws', async () => {
    const source = createPushSource<number>(() => {
      throw new Error('push hook boom');
    });
    const coordinator = createAsyncCoordinator([source]);

    source.push(1);

    const event = { type: 'value' as const, value: 1, sourceIndex: 0 };

    expect(await coordinator.next()).toEqual(
      NEXT(event)
    );

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

  it('returns null while an async source is still pending and ignores late results from removed sources', async () => {
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

    expect(coordinator.__tryNext?.()).toBeNull();
    expect(coordinator.__hasBufferedValues?.()).toBeFalse();

    await coordinator.removeSource(0);
    deferred.resolve(NEXT(1));
    await flush();

    expect(returned).toBeTrue();
    expect(coordinator.getActiveSourceCount()).toBe(0);
    expect(await coordinator.next()).toEqual(DONE);
  });

  it('ignores invalid removals and reports completion for invalid indices', async () => {
    const coordinator = createAsyncCoordinator<number>();

    await coordinator.removeSource(-1);
    await coordinator.removeSource(0);
    await coordinator.removeSourceByKey('missing');

    expect(coordinator.__hasBufferedValues?.()).toBeTrue();
    expect(coordinator.__tryNext?.()).toEqual(DONE);
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
