import {
  atom,
  createSubscription,
  flow,
  waitForDisposal,
  type Atom,
} from '@epikodelabs/streamix';
import {
  effectScope,
  type EffectScope,
} from 'vue';
import { createIterableBridge, useIterable } from '../lib/useIterable';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useIterable', () => {
  let vueScope: EffectScope;

  beforeEach(() => {
    vueScope = effectScope();
  });

  afterEach(() => {
    vueScope.stop();
  });

  it('reads the current Streamix value and stays live', () => {
    const count = atom(0);
    const value = vueScope.run(() => useIterable(count))!;

    expect(value.value).toBe(0);

    count.next(1);
    expect(value.value).toBe(1);
  });

  it('reports a rejected subscription teardown when its scope stops', async () => {
    const failure = new Error('unsubscribe failed');
    const report = spyOn(console, 'error');
    const source = atom('ok');
    const subscribe = source.subscribe.bind(source);
    spyOn(source, 'subscribe').and.callFake(callback => {
      const stop = subscribe(callback);
      return createSubscription(async () => { await stop(); throw failure; });
    });
    vueScope.run(() => useIterable(source));
    vueScope.stop();
    await expectAsync(waitForDisposal(vueScope)).toBeRejectedWith(failure);
    expect(report).toHaveBeenCalledWith(jasmine.stringMatching(/disposal failed/), failure);
    source.dispose();
  });

  it('invalidates even when the source emits the same object identity', () => {
    const object = { count: 0 };
    const source = atom(object);
    const value = vueScope.run(() => useIterable(source))!;

    object.count = 1;
    source.next(object);

    expect(value.value).toBe(object);
    expect(value.value.count).toBe(1);
  });

  it('unsubscribes when the current Vue effect scope stops', () => {
    const count = atom(0);

    vueScope.run(() => useIterable(count));
    expect(count.subscriberCount).toBe(1);

    vueScope.stop();
    expect(count.subscriberCount).toBe(0);
  });

  it('fails before subscribing when called without an active Vue effect scope', () => {
    const count = atom(0);

    expect(() => useIterable(count)).toThrowError(/active effectScope/);
    expect(count.subscriberCount).toBe(0);
  });

  it('supports explicit manual ownership outside a Vue effect scope', () => {
    const count = atom(0);
    const bridge = createIterableBridge(count);

    expect(bridge.ref.value).toBe(0);
    expect(count.subscriberCount).toBe(1);

    count.next(1);
    expect(bridge.ref.value).toBe(1);

    bridge.dispose();
    bridge.dispose();
    expect(count.subscriberCount).toBe(0);
  });

  it('disposes a factory-owned source when a manual bridge ends', () => {
    let created!: Atom<number>;
    const bridge = createIterableBridge(() => {
      created = atom(0);
      return created;
    });

    expect(created.disposed).toBe(false);
    bridge.dispose();
    expect(created.disposed).toBe(true);
  });

  it('does not dispose an externally-owned source', () => {
    const count = atom(0);

    vueScope.run(() => useIterable(count));
    vueScope.stop();

    expect(count.disposed).toBe(false);
  });

  it('disposes a factory-owned Streamix source', () => {
    let created!: Atom<number>;

    vueScope.run(() => useIterable(() => {
      created = atom(0);
      return created;
    }));

    expect(created.disposed).toBe(false);
    vueScope.stop();
    expect(created.disposed).toBe(true);
  });

  it('uses initialValue when a dependency source currently exposes undefined', () => {
    const source = atom<number | undefined>(undefined);
    const value = vueScope.run(() => useIterable(source, -1))!;

    expect(value.value).toBe(-1);
  });

  it('keeps serving the last emission after a completed flow disposes itself', async () => {
    const completed = flow(async function* () {
      yield 'Loading tasks…';
      yield 'Tasks synced';
    });

    const value = vueScope.run(() => useIterable(completed))!;

    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The finished flow disposed its backing atom; the ref must answer with
    // the final emission instead of throwing into every later render.
    expect(value.value).toBe('Tasks synced');
  });

  it('consumes a plain async iterable and exposes its latest emission', async () => {
    let emit!: (value: number) => void;

    async function* values() {
      while (true) {
        const value = await new Promise<number>((resolve) => {
          emit = resolve;
        });
        yield value;
      }
    }

    const value = vueScope.run(() => useIterable(values(), -1))!;
    expect(value.value).toBe(-1);

    emit(7);
    await flushMicrotasks();

    expect(value.value).toBe(7);
  });

  it('closes a plain async iterator when the Vue effect scope stops', async () => {
    let closed = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => {}),
          return: async () => {
            closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };

    vueScope.run(() => useIterable(source, 0));
    vueScope.stop();
    await flushMicrotasks();

    expect(closed).toBe(true);
  });

  it('reports a rejected unsubscription instead of leaving it unhandled', async () => {
    const errorSpy = spyOn(console, 'error');
    const source = {
      value: 1,
      disposed: false,
      subscribe: () => () => Promise.reject(new Error('unsubscribe failed')),
    } as unknown as import('@epikodelabs/streamix').DependencySource<number>;

    vueScope.run(() => useIterable(source));
    vueScope.stop();
    await expectAsync(waitForDisposal(vueScope)).toBeRejectedWithError('unsubscribe failed');

    expect(errorSpy).toHaveBeenCalledWith(
      jasmine.stringContaining('disposal failed'),
      jasmine.any(Error),
    );
  });

  it('reports a rejected iterator return instead of leaving it unhandled', async () => {
    const errorSpy = spyOn(console, 'error');
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => {}),
          return: () => Promise.reject(new Error('return failed')),
        };
      },
    };

    vueScope.run(() => useIterable(source, 0));
    vueScope.stop();
    await expectAsync(waitForDisposal(vueScope)).toBeRejectedWithError('return failed');

    expect(errorSpy).toHaveBeenCalledWith(
      jasmine.stringContaining('disposal failed'),
      jasmine.any(Error),
    );
  });

  it('closes a manually owned async iterator on dispose', async () => {
    let closed = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => {}),
          return: async () => {
            closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };

    const bridge = createIterableBridge(source, 0);
    bridge.dispose();
    await flushMicrotasks();

    expect(closed).toBe(true);
  });
});
