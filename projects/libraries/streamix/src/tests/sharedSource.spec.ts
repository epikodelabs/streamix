import {
    ANALOG,
    createSharedSource,
    DONE,
    NEXT,
} from '@epikodelabs/streamix';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
type Push<T> = (value: T) => void | Promise<void>;
const eventually = async (assertion: () => void, attempts = 10) => {
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }

  throw lastError;
};

describe('createSharedSource', () => {
  it('starts producer on first subscription and stops on last unsubscribe', async () => {
    const cleanup = jasmine.createSpy('cleanup');

    const source = createSharedSource<number>(() => cleanup);

    expect(source.subscriberCount).toBe(0);
    expect(source.disposed).toBeFalse();

    const sub = source.subscribe(() => {});

    expect(source.subscriberCount).toBe(1);
    expect(cleanup).not.toHaveBeenCalled();

    await sub();
    await flush();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('delivers pushed values to subscribers', async () => {
    let push!: Push<number>;
    const values: number[] = [];

    const source = createSharedSource<number>((p) => {
      push = p;
      return () => {};
    });

    const sub = source.subscribe(value => {
      values.push(value);
    });

    await push(1);
    await push(2);
    await flush();

    expect(values).toEqual([1, 2]);

    await sub();
  });

  it('shares one producer between multiple subscribers', async () => {
    let connectCount = 0;
    let push!: Push<number>;

    const a: number[] = [];
    const b: number[] = [];

    const source = createSharedSource<number>((p) => {
      connectCount++;
      push = p;
      return () => {};
    });

    const subA = source.subscribe(value => a.push(value));
    const subB = source.subscribe(value => b.push(value));

    await push(10);
    await flush();

    expect(connectCount).toBe(1);
    expect(a).toEqual([10]);
    expect(b).toEqual([10]);

    await subA();
    await subB();
  });

  it('restarts producer after all subscribers unsubscribe and a new subscriber appears', async () => {
    let connectCount = 0;
    let cleanupCount = 0;

    const source = createSharedSource<number>(() => {
      connectCount++;
      return () => {
        cleanupCount++;
      };
    });

    const subA = source.subscribe(() => {});
    await subA();
    await flush();

    const subB = source.subscribe(() => {});
    await flush();

    expect(connectCount).toBe(2);
    expect(cleanupCount).toBe(1);

    await subB();
  });

  it('supports async iterator consumption', async () => {
    let push!: Push<number>;

    const source = createSharedSource<number>((p) => {
      push = p;
      return () => {};
    });

    const iterator = source[Symbol.asyncIterator]();

    const first = iterator.next();
    await push(1);

    expect(await first).toEqual(NEXT(1));

    await iterator.return?.();
  });

  it('allows only one active async iterator', async () => {
    const source = createSharedSource<number>(() => () => {});

    const first = source[Symbol.asyncIterator]();
    const second = source[Symbol.asyncIterator]();

    expect(await second.next()).toEqual(DONE);

    await first.return?.();
  });

  it('stops producer when async iterator returns', async () => {
    const cleanup = jasmine.createSpy('cleanup');

    const source = createSharedSource<number>(() => cleanup);

    const iterator = source[Symbol.asyncIterator]();

    await iterator.return?.();
    await flush();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('rejects pending iterator next when iterator returns', async () => {
    const source = createSharedSource<number>(() => () => {});
    const iterator = source[Symbol.asyncIterator]();

    const pending = iterator.next();

    await iterator.return?.();

    await expectAsync(pending).toBeRejectedWithError('Iterator returned');
  });

  it('delivers values to both subscribers and iterator', async () => {
    let push!: Push<number>;

    const subscriberValues: number[] = [];

    const source = createSharedSource<number>((p) => {
      push = p;
      return () => {};
    });

    const sub = source.subscribe(value => {
      subscriberValues.push(value);
    });

    const iterator = source[Symbol.asyncIterator]();

    const first = iterator.next();
    await push(7);
    await flush();

    expect(await first).toEqual(NEXT(7));
    expect(subscriberValues).toEqual([7]);

    await iterator.return?.();
    await sub();
  });

  it('waits for async subscribers before distributing the next value', async () => {
    let push!: Push<number>;
    const events: string[] = [];

    const source = createSharedSource<number>((p) => {
      push = p;
      return () => {};
    });

    const sub = source.subscribe(async value => {
      events.push(`start:${value}`);
      await flush();
      events.push(`end:${value}`);
    });

    const first = push(1);
    await first;

    await eventually(() => {
      expect(events).toEqual(['start:1', 'end:1']);
    });

    await sub();
  });

  it('swallows subscriber callback errors', async () => {
    let push!: Push<number>;
    const values: number[] = [];

    const source = createSharedSource<number>((p) => {
      push = p;
      return () => {};
    });

    const subA = source.subscribe(() => {
      throw new Error('subscriber boom');
    });

    const subB = source.subscribe(value => {
      values.push(value);
    });

    await push(1);

    await eventually(() => {
      expect(values).toEqual([1]);
    });

    await subA();
    await subB();
  });

  it('completes source when connect throws', async () => {
    const source = createSharedSource<number>(() => {
      throw new Error('connect boom');
    });

    source.subscribe(() => {});
    await flush();

    expect(source.error).toEqual(jasmine.any(Error));
    expect(source.disposed).toBeFalse();

    source.dispose();
  });

  it('returns DONE iterator after source is disposed', async () => {
    const source = createSharedSource<number>(() => () => {});

    source.dispose();

    const iterator = source[Symbol.asyncIterator]();

    expect(await iterator.next()).toEqual(DONE);
  });

  it('normalizes throw and return on fallback iterators', async () => {
    const source = createSharedSource<number>(() => () => {});

    const active = source[Symbol.asyncIterator]();
    const duplicate = source[Symbol.asyncIterator]();

    await expectAsync(duplicate.return!()).toBeResolvedTo(DONE);
    await expectAsync(duplicate.throw!('duplicate boom')).toBeRejectedWithError('duplicate boom');

    await active.return?.();
    source.dispose();

    const completed = source[Symbol.asyncIterator]();

    await expectAsync(completed.return!()).toBeResolvedTo(DONE);
    await expectAsync(completed.throw!('completed boom')).toBeRejectedWithError('completed boom');
  });

  it('ignores pushes after dispose', async () => {
    let push!: Push<number>;
    const values: number[] = [];

    const source = createSharedSource<number>((p) => {
      push = p;
      return () => {};
    });

    source.subscribe(value => values.push(value));

    source.dispose();

    await push(1);
    await flush();

    expect(values).toEqual([]);
    expect(await source[Symbol.asyncIterator]().next()).toEqual(DONE);
  });

  it('reports subscriberCount', async () => {
    const source = createSharedSource<number>(() => () => {});

    const a = source.subscribe(() => {});
    const b = source.subscribe(() => {});

    expect(source.subscriberCount).toBe(2);

    await a();
    expect(source.subscriberCount).toBe(1);

    await b();
    expect(source.subscriberCount).toBe(0);
  });

  it('uses provided name', () => {
    const source = createSharedSource<number>(() => () => {}, {
      name: 'numbers',
    });

    expect(source.name).toBe('numbers');

    source.dispose();
  });

  it('marks analog flag when mode is analog', () => {
    const source = createSharedSource<number>(() => () => {}, {
      mode: 'analog',
    });

    expect((source as any)[ANALOG]).toBeTrue();

    source.dispose();
  });
});
