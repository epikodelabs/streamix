import { scheduler } from '@actioncrew/streamix';
import { onIdle } from '@actioncrew/streamix/dom';
import { ndescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

function defineGlobal(name: string, value: any) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, name);

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (desc) {
      Object.defineProperty(globalThis, name, desc);
    } else {
      delete (globalThis as any)[name];
    }
  };
}

/* -------------------------------------------------- */
/* IdleCallback mock                                  */
/* -------------------------------------------------- */

type IdleCB = (deadline: IdleDeadline) => void;

function mockRICEnv() {
  let nextId = 1;
  const callbacks = new Map<number, IdleCB>();

  const requestIdleCallback = jasmine
    .createSpy('requestIdleCallback')
    .and.callFake((cb: IdleCB) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    });

  const cancelIdleCallback = jasmine
    .createSpy('cancelIdleCallback')
    .and.callFake((id: number) => {
      callbacks.delete(id);
    });

  function fireIdle(didTimeout = false) {
    const entries = [...callbacks.entries()];
    callbacks.clear();

    for (const [, cb] of entries) {
      cb({
        didTimeout,
        timeRemaining: () => 5,
      } as IdleDeadline);
    }
  }

  return {
    requestIdleCallback,
    cancelIdleCallback,
    fireIdle,
  };
}

/* -------------------------------------------------- */
/* setTimeout fallback mock                            */
/* -------------------------------------------------- */

function mockTimeoutEnv() {
  let nextId = 1;
  const timers = new Map<number, () => void>();

  const setTimeoutMock = jasmine
    .createSpy('setTimeout')
    .and.callFake((cb: () => void) => {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    });

  const clearTimeoutMock = jasmine
    .createSpy('clearTimeout')
    .and.callFake((id: number) => {
      timers.delete(id);
    });

  function fireAll() {
    const entries = [...timers.entries()];
    timers.clear();
    entries.forEach(([, cb]) => cb());
  }

  return {
    setTimeoutMock,
    clearTimeoutMock,
    fireAll,
  };
}

/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

ndescribe('onIdle (requestIdleCallback)', () => {
  let restoreRIC: () => void;
  let restoreCancelRIC: () => void;
  let restoreSetTimeout: () => void;
  let restoreClearTimeout: () => void;

  afterEach(() => {
    restoreRIC?.();
    restoreCancelRIC?.();
    restoreSetTimeout?.();
    restoreClearTimeout?.();
  });

  /* -------------------------------------------------- */
  /* requestIdleCallback path                           */
  /* -------------------------------------------------- */

  it('emits idle deadlines using requestIdleCallback', async () => {
    const env = mockRICEnv();

    restoreRIC = defineGlobal('requestIdleCallback', env.requestIdleCallback);
    restoreCancelRIC = defineGlobal('cancelIdleCallback', env.cancelIdleCallback);

    const values: IdleDeadline[] = [];
    const stream = onIdle();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.fireIdle();
    await flush();

    expect(values.length).toBe(1);
    expect(values[0].didTimeout).toBeFalse();
    expect(values[0].timeRemaining()).toBeGreaterThan(0);

    sub.unsubscribe();
  });

  it('continues scheduling idle callbacks until unsubscribed', async () => {
    const env = mockRICEnv();

    restoreRIC = defineGlobal('requestIdleCallback', env.requestIdleCallback);
    restoreCancelRIC = defineGlobal('cancelIdleCallback', env.cancelIdleCallback);

    const values: IdleDeadline[] = [];
    const stream = onIdle();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.fireIdle();
    env.fireIdle();
    await flush();

    expect(values.length).toBe(2);

    sub.unsubscribe();
  });

  it('cancels idle callback when last subscriber unsubscribes', async () => {
    const env = mockRICEnv();

    restoreRIC = defineGlobal('requestIdleCallback', env.requestIdleCallback);
    restoreCancelRIC = defineGlobal('cancelIdleCallback', env.cancelIdleCallback);

    const stream = onIdle();

    const sub = stream.subscribe();
    await flush();

    sub.unsubscribe();
    await flush();

    expect(env.cancelIdleCallback).toHaveBeenCalled();
  });

  /* -------------------------------------------------- */
  /* setTimeout fallback                                */
  /* -------------------------------------------------- */

  it('falls back to setTimeout when requestIdleCallback is unavailable', async () => {
    const env = mockTimeoutEnv();

    restoreRIC = defineGlobal('requestIdleCallback', undefined);
    restoreCancelRIC = defineGlobal('cancelIdleCallback', undefined);
    restoreSetTimeout = defineGlobal('setTimeout', env.setTimeoutMock);
    restoreClearTimeout = defineGlobal('clearTimeout', env.clearTimeoutMock);

    const values: IdleDeadline[] = [];
    const stream = onIdle();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.fireAll();
    await flush();

    expect(values.length).toBe(1);
    expect(values[0].didTimeout).toBeFalse();

    sub.unsubscribe();
  });

  it('clears timeout on unsubscribe in fallback mode', async () => {
    const env = mockTimeoutEnv();

    restoreRIC = defineGlobal('requestIdleCallback', undefined);
    restoreCancelRIC = defineGlobal('cancelIdleCallback', undefined);
    restoreSetTimeout = defineGlobal('setTimeout', env.setTimeoutMock);
    restoreClearTimeout = defineGlobal('clearTimeout', env.clearTimeoutMock);

    const stream = onIdle();

    const sub = stream.subscribe();
    await flush();

    sub.unsubscribe();
    await flush();

    expect(env.clearTimeoutMock).toHaveBeenCalled();
  });

  /* -------------------------------------------------- */
  /* Async iteration                                    */
  /* -------------------------------------------------- */

  it('supports async iteration', async () => {
    const env = mockRICEnv();

    restoreRIC = defineGlobal('requestIdleCallback', env.requestIdleCallback);
    restoreCancelRIC = defineGlobal('cancelIdleCallback', env.cancelIdleCallback);

    const stream = onIdle();

    const iter = (async () => {
      const out: IdleDeadline[] = [];
      for await (const v of stream) {
        out.push(v);
        if (out.length === 1) break;
      }
      return out;
    })();

    await flush();
    env.fireIdle();
    await flush();

    const values = await iter;
    expect(values.length).toBe(1);
  });

  /* -------------------------------------------------- */
  /* SSR safety                                         */
  /* -------------------------------------------------- */

  it('is SSR-safe when setTimeout is unavailable', async () => {
    restoreSetTimeout = defineGlobal('setTimeout', undefined);
    restoreClearTimeout = defineGlobal('clearTimeout', undefined);

    const values: IdleDeadline[] = [];
    const stream = onIdle();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]);

    sub.unsubscribe();
  });
});
