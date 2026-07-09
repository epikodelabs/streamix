import { flow, iterate, observeOn, pipe } from '@epikodelabs/streamix';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('observeOn', () => {
  let originalRequestIdleCallback: typeof requestIdleCallback;
  let mockRequestIdleCallback: jasmine.Spy;

  beforeEach(() => {
    originalRequestIdleCallback = (globalThis as any).requestIdleCallback;
    mockRequestIdleCallback = jasmine
      .createSpy('requestIdleCallback')
      .and.callFake((callback: IdleRequestCallback) => {
        setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline), 0);
        return 1;
      });

    (globalThis as any).requestIdleCallback = mockRequestIdleCallback;
  });

  afterEach(() => {
    (globalThis as any).requestIdleCallback = originalRequestIdleCallback;
  });

  it('should emit values using microtask scheduling', async () => {
    const values: number[] = [];
    const emissionOrder: string[] = [];

    const stream = flow(async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    const observeOnAtom = pipe(stream, observeOn('microtask'));

    void (async () => {
      for await (const value of iterate(observeOnAtom)) {
        emissionOrder.push(`value-${value}`);
        values.push(value);
      }
      emissionOrder.push('complete');
    })();

    emissionOrder.push('sync-after-subscribe');
    await wait(0);

    expect(values).toEqual([1, 2, 3]);
    expect(emissionOrder[0]).toBe('sync-after-subscribe');
    expect(emissionOrder).toContain('value-1');
    expect(emissionOrder[emissionOrder.length - 1]).toBe('complete');
  });

  it('should emit values using macrotask scheduling', async () => {
    const values: number[] = [];

    const stream = flow(async function* () {
      yield 1;
      yield 2;
    });

    const observeOnAtom = pipe(stream, observeOn('macrotask'));

    const done = (async () => {
      for await (const value of iterate(observeOnAtom)) {
        values.push(value);
      }
    })();

    await done;

    expect(values).toEqual([1, 2]);
  });

  it('should emit values using idle scheduling', async () => {
    const values: number[] = [];

    const stream = flow(async function* () {
      yield 1;
      yield 2;
    });

    const observeOnAtom = pipe(stream, observeOn('idle'));

    const done = (async () => {
      for await (const value of iterate(observeOnAtom)) {
        values.push(value);
      }
    })();

    await done;

    expect(values).toEqual([1, 2]);
    expect(mockRequestIdleCallback).toHaveBeenCalled();
  });

  it('should propagate errors asynchronously', async () => {
    const error = new Error('Test error');

    const stream = flow(async function* () {
      yield 1;
      throw error;
    });

    const observeOnAtom = pipe(stream, observeOn('microtask'));
    const values: number[] = [];

    try {
      for await (const value of iterate(observeOnAtom)) {
        values.push(value);
      }
      fail('Should have thrown an error');
    } catch (err) {
      expect(values).toEqual([1]);
      expect(err).toBe(error);
    }
  });

  it('should handle empty streams', async () => {
    const values: number[] = [];

    const stream = flow(async function* () {
      // Empty generator
    });

    const observeOnAtom = pipe(stream, observeOn('microtask'));

    for await (const value of iterate(observeOnAtom)) {
      values.push(value);
    }

    expect(values).toEqual([]);
  });

  it('should fall back to setTimeout when idle scheduling is requested without requestIdleCallback', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').and.callFake(
      ((fn: any, ms?: any, ...rest: any[]) =>
        (originalSetTimeout as any)(fn, ms, ...rest)) as any
    );
    (globalThis as any).requestIdleCallback = undefined;

    const values: number[] = [];
    const stream = flow(async function* () {
      yield 1;
      yield 2;
    });

    for await (const value of iterate(pipe(stream, observeOn('idle')))) {
      values.push(value);
    }

    expect(values).toEqual([1, 2]);
    expect(setTimeoutSpy).toHaveBeenCalled();
  });

  it('should cancel pending macrotasks when iterator.return is used', async () => {
    const sourceReturn = jasmine.createSpy('sourceReturn').and.rejectWith(new Error('ignored'));
    const source = {
      step: 0,
      async next() {
        this.step++;
        if (this.step === 1) return { value: 1, done: false as const };
        if (this.step === 2) return { value: 2, done: false as const };
        return new Promise<IteratorResult<number>>(() => {});
      },
      return: sourceReturn,
    } as AsyncIterator<number> & { step: number };

    const iterator = observeOn<number>('macrotask').apply(source);
    await Promise.resolve();

    expect(await iterator.return?.()).toEqual({ value: undefined, done: true });
    expect(sourceReturn).toHaveBeenCalled();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('should cancel idle callbacks and normalize iterator.throw errors', async () => {
    const idleIds: number[] = [];
    const cancelIdleCallbackSpy = jasmine.createSpy('cancelIdleCallback');
    (globalThis as any).requestIdleCallback = jasmine
      .createSpy('requestIdleCallback')
      .and.callFake((_callback: IdleRequestCallback) => {
        const id = idleIds.length + 1;
        idleIds.push(id);
        return id;
      });
    (globalThis as any).cancelIdleCallback = cancelIdleCallbackSpy;

    const stream = flow(async function* () {
      yield 1;
      yield 2;
    });

    const iterator = observeOn<number>('idle').apply(stream[Symbol.asyncIterator]());
    await wait(0);

    await expectAsync(iterator.throw?.('stop')).toBeRejectedWithError('stop');
    expect(cancelIdleCallbackSpy).toHaveBeenCalledWith(idleIds[0]);
  });

  it('should cancel idle fallback timeouts when iterator.return is used before they fire', async () => {
    (globalThis as any).requestIdleCallback = undefined;

    const stream = flow(async function* () {
      yield 1;
      yield 2;
    });

    const iterator = observeOn<number>('idle').apply(stream[Symbol.asyncIterator]());
    await Promise.resolve();

    expect(await iterator.return?.()).toEqual({ value: undefined, done: true });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
