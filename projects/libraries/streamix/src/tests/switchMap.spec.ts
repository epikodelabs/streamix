import { collect } from './helpers/operator';
import { atom, DONE, flow, from, iterate, NEXT, pipe, switchMap } from '@epikodelabs/streamix';
import type { StreamixSource, SyncPoll } from '../lib/utils/source-protocol';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('switchMap', () => {
  it('switchMap waits for an in-flight promise projection before completing', async () => {
    const values = await collect<unknown>(iterate(pipe(
      from([1]),
      switchMap((value: number) => new Promise<number[]>((resolve) => {
        setTimeout(() => resolve([value, value * 10]), 30);
      })),
    )));

    expect(values).toEqual([1, 10]);
  });

  it('cancels a pending inner pull immediately without disposing the outer flow', async () => {
    const source = atom(false);
    let pulled = false;
    let returned = false;
    let settle: ((result: IteratorResult<number>) => void) | undefined;
    const inner: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        next: () => { pulled = true; return new Promise(resolve => { settle = resolve; }); },
        return: async () => { returned = true; settle?.(DONE); return DONE; },
      }),
    };
    const result = pipe(source, switchMap(active => active ? inner : []));
    const subscription = result.subscribe();
    source.set(true);
    await wait(10);
    expect(pulled).toBeTrue();
    source.set(false);
    await wait(10);
    expect(returned).toBeTrue();
    expect(result.disposed).toBeFalse();
    await subscription();
    source.dispose();
  });

  it('emits values from the latest inner source for a synchronous source burst', async () => {
    const values: number[] = [];

    for await (const value of iterate(pipe(from([1, 2]), switchMap(value => [value, value * 10])))) {
      values.push(value);
    }

    expect(values).toEqual([2, 20]);
  });

  it('drops stale promise results and emits only the latest promise', async () => {
    const source = atom<number>();
    const values: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(
        source,
        switchMap(value => new Promise<number>(resolve => {
          setTimeout(() => resolve(value * 10), value === 1 ? 30 : 1);
        }))
      ))) {
        values.push(value);
      }
    })();

    source.next(1);
    source.next(2);
    await wait(50);
    source.dispose();

    await reader;
    expect(values).toEqual([20]);
  });

  it('cancels the previous inner iterator when a new source value arrives', async () => {
    const source = atom<number>();
    let firstInnerReturned = 0;

    const makeInner = (value: number): AsyncIterable<number> => ({
      [Symbol.asyncIterator]() {
        let emitted = false;
        return {
          next: async () => {
            if (!emitted) {
              emitted = true;
              await wait(value === 1 ? 25 : 0);
              return NEXT(value);
            }
            return new Promise<IteratorResult<number>>(() => {});
          },
          return: async () => {
            if (value === 1) firstInnerReturned++;
            return DONE;
          },
        };
      },
    });

    const values: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, switchMap(makeInner)))) {
        values.push(value);
        if (values.length === 1) break;
      }
    })();

    source.next(1);
    await wait(0);
    source.next(2);

    await reader;
    source.dispose();

    expect(values).toEqual([2]);
    expect(firstInnerReturned).toBe(1);
  });

  it('propagates active inner errors', async () => {
    const source = atom<number>();
    const inner = atom<number>();
    const reader = (async () => {
      for await (const _ of iterate(pipe(source, switchMap(() => inner)))) {
        void _;
      }
    })();

    source.next(1);
    await wait(0);
    inner.fail(new Error('boom'));

    await expectAsync(reader).toBeRejectedWithError('boom');
  });

  it('supports push-based sources via pollSync and onReady', async () => {
    const buffer: number[] = [1];
    let done = false;
    let notify: (() => void) | undefined;

    const sourceIterator = {
      pollSync(): { status: 'available'; result: IteratorResult<number> } | { status: 'unavailable' } {
        if (buffer.length > 0) return { status: 'available', result: NEXT(buffer.shift()!) };
        if (done) return { status: 'available', result: DONE };
        return { status: 'unavailable' };
      },
      onReady(listener: () => void) {
        notify = listener;
        return () => {
          if (notify === listener) notify = undefined;
        };
      },
      next: async () => {
        throw new Error('next() should not be used when pollSync is present');
      },
    };

    const iterator = switchMap<number, number>(value => from([value, value * 10])).apply(sourceIterator);
    const valuesPromise = (async () => {
      const values: number[] = [];
      for await (const value of { [Symbol.asyncIterator]: () => iterator } as AsyncIterable<number>) {
        values.push(value);
      }
      return values;
    })();

    buffer.push(2, 3);
    notify!();
    done = true;
    notify!();

    expect(await valuesPromise).toEqual([3, 30]);
    expect(notify).toBeUndefined();
  });

  it('uses async pull when a polling source has no readiness notifications', async () => {
    let calls = 0;
    const next = jasmine.createSpy('next').and.callFake(async () => ++calls === 1 ? NEXT(7) : DONE);
    const source: StreamixSource<number> = {
      pollSync: () => ({ status: 'unavailable' }),
      next,
    };
    const iterator = switchMap<number, number>(value => [value]).apply(source);

    try {
      expect(await iterator.next()).toEqual(NEXT(7));
      expect(await iterator.next()).toEqual(DONE);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      await iterator.return?.();
    }
  });

  for (const outcome of ['complete', 'error', 'return', 'throw'] as const) {
    it(`unsubscribes from source readiness on ${outcome}`, async () => {
      let poll: SyncPoll<number> = { status: 'unavailable' };
      let pollError: Error | undefined;
      let notify: (() => void) | undefined;
      const unsubscribe = jasmine.createSpy('unsubscribe').and.callFake(() => { notify = undefined; });
      const source: StreamixSource<number> = {
        pollSync() {
          if (pollError) throw pollError;
          return poll;
        },
        onReady(listener) { notify = listener; return unsubscribe; },
        next: async () => { throw new Error('push source should be polled'); },
        return: async () => DONE,
      };
      const iterator = switchMap<number, number>(value => [value]).apply(source);

      expect(unsubscribe).not.toHaveBeenCalled();
      if (outcome === 'complete') {
        poll = { status: 'available', result: DONE };
        notify!();
        expect(await iterator.next()).toEqual(DONE);
      } else if (outcome === 'error') {
        pollError = new Error('outer failed');
        notify!();
        await expectAsync(iterator.next()).toBeRejectedWithError('outer failed');
      } else if (outcome === 'return') {
        expect(await iterator.return?.()).toEqual(DONE);
      } else {
        await expectAsync(iterator.throw?.(new Error('stop'))).toBeRejectedWithError('stop');
      }

      expect(notify).toBeUndefined();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      await iterator.return?.();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  }

  it('unsubscribes from a completed outer source while its projection is pending', async () => {
    let resolve!: (value: number) => void;
    const pending = new Promise<number>(release => { resolve = release; });
    const buffer = [1];
    let done = false;
    let notify: (() => void) | undefined;
    const unsubscribe = jasmine.createSpy('unsubscribe').and.callFake(() => { notify = undefined; });
    const source: StreamixSource<number> = {
      pollSync: () => buffer.length
        ? { status: 'available', result: NEXT(buffer.shift()!) }
        : done ? { status: 'available', result: DONE } : { status: 'unavailable' },
      onReady(listener) { notify = listener; return unsubscribe; },
      next: async () => { throw new Error('push source should be polled'); },
    };
    const iterator = switchMap<number, number>(() => pending).apply(source);

    try {
      done = true;
      notify!();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      resolve(42);
      expect(await iterator.next()).toEqual(NEXT(42));
      expect(await iterator.next()).toEqual(DONE);
    } finally {
      resolve(42);
      await iterator.return?.();
    }
  });

  it('releases a readiness subscription when registration signals completion', async () => {
    const unsubscribe = jasmine.createSpy('unsubscribe');
    const source: StreamixSource<number> = {
      pollSync: () => ({ status: 'available', result: DONE }),
      onReady(listener) { listener(); return unsubscribe; },
      next: async () => DONE,
    };
    const iterator = switchMap<number, number>(value => [value]).apply(source);

    expect(await iterator.next()).toEqual(DONE);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await iterator.return?.();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('returns and throws cleanly', async () => {
    const source = flow<number>(async function* () {
      yield 1;
      await wait(50);
      yield 2;
    });

    const iterator = switchMap<number, number>(value => from([value])).apply(iterate(source)[Symbol.asyncIterator]() as any);
    expect(await iterator.next()).toEqual(NEXT(1));
    expect(await iterator.return?.()).toEqual(DONE);

    const throwing = switchMap<number, number>(value => from([value])).apply(from([1])[Symbol.asyncIterator]() as any);
    expect(await throwing.next()).toEqual(NEXT(1));
    await expectAsync(throwing.throw?.(new Error('stop')) as Promise<any>).toBeRejectedWithError('stop');
  });
});

describe('switchMap execution generations', () => {
  it('ignores a rejected projection from an obsolete generation', async () => {
    const source = atom<number>();
    const seen: number[] = [];
    const reader = (async () => {
      for await (const value of iterate(pipe(source, switchMap(value =>
        value === 1
          ? new Promise<number>((_, reject) => setTimeout(() => reject(new Error('stale')), 20))
          : Promise.resolve(42)
      )))) seen.push(value);
    })();

    source.next(1);
    source.next(2);
    await wait(35);
    source.dispose();
    await reader;
    expect(seen).toEqual([42]);
  });

});
