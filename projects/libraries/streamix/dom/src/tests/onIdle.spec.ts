import { scheduler } from '@epikodelabs/streamix';
import { onIdle } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

function patchGlobal<K extends keyof typeof globalThis>(
  key: K,
  value: any
) {
  const obj = globalThis as any;
  const desc = Object.getOwnPropertyDescriptor(obj, key);

  Object.defineProperty(obj, key, {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (desc) {
      Object.defineProperty(obj, key, desc);
    } else {
      delete obj[key];
    }
  };
}

async function flush() {
  await scheduler.flush();
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

idescribe('onIdle', () => {
  let restore: (() => void)[] = [];

  afterEach(() => {
    restore.forEach(fn => fn());
    restore = [];
  });

  /* -------------------------------------------------- */
  /* requestIdleCallback path                           */
  /* -------------------------------------------------- */

  it('emits idle deadlines using requestIdleCallback', async () => {
    const env = mockRICEnv();

    restore.push(
      patchGlobal('requestIdleCallback', env.requestIdleCallback),
      patchGlobal('cancelIdleCallback', env.cancelIdleCallback)
    );

    const values: IdleDeadline[] = [];
    const sub = onIdle().subscribe(v => values.push(v));
    await flush();

    env.fireIdle();
    await flush();

    expect(values.length).toBe(1);
    expect(values[0].didTimeout).toBeFalse();
    expect(values[0].timeRemaining()).toBeGreaterThan(0);

    sub.unsubscribe();
  });

  it('continues scheduling until unsubscribed', async () => {
    const env = mockRICEnv();

    restore.push(
      patchGlobal('requestIdleCallback', env.requestIdleCallback),
      patchGlobal('cancelIdleCallback', env.cancelIdleCallback)
    );

    const values: IdleDeadline[] = [];
    const sub = onIdle().subscribe(v => values.push(v));
    await flush();

    env.fireIdle();
    env.fireIdle();
    await flush();

    expect(values.length).toBe(2);
    sub.unsubscribe();
  });

  it('cancels idle callback on unsubscribe', async () => {
    const env = mockRICEnv();

    restore.push(
      patchGlobal('requestIdleCallback', env.requestIdleCallback),
      patchGlobal('cancelIdleCallback', env.cancelIdleCallback)
    );

    const sub = onIdle().subscribe();
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

    restore.push(
      patchGlobal('requestIdleCallback', undefined),
      patchGlobal('cancelIdleCallback', undefined),
      patchGlobal('setTimeout', env.setTimeoutMock),
      patchGlobal('clearTimeout', env.clearTimeoutMock)
    );

    const values: IdleDeadline[] = [];
    const sub = onIdle().subscribe(v => values.push(v));
    await flush();

    env.fireAll();
    await flush();

    expect(values.length).toBe(1);
    expect(values[0].didTimeout).toBeFalse();

    sub.unsubscribe();
  });

  it('clears timeout on unsubscribe in fallback mode', async () => {
    const env = mockTimeoutEnv();

    restore.push(
      patchGlobal('requestIdleCallback', undefined),
      patchGlobal('cancelIdleCallback', undefined),
      patchGlobal('setTimeout', env.setTimeoutMock),
      patchGlobal('clearTimeout', env.clearTimeoutMock)
    );

    const sub = onIdle().subscribe();
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

    restore.push(
      patchGlobal('requestIdleCallback', env.requestIdleCallback),
      patchGlobal('cancelIdleCallback', env.cancelIdleCallback)
    );

    const iter = (async () => {
      const out: IdleDeadline[] = [];
      for await (const v of onIdle()) {
        out.push(v);
        if (out.length === 1) break;
      }
      return out;
    })();

    await flush();
    env.fireIdle();
    await flush();

    expect((await iter).length).toBe(1);
  });

  /* -------------------------------------------------- */
  /* SSR safety                                         */
  /* -------------------------------------------------- */

  it('is SSR-safe when no scheduler APIs exist', async () => {
    restore.push(
      patchGlobal('requestIdleCallback', undefined),
      patchGlobal('cancelIdleCallback', undefined),
      patchGlobal('setTimeout', undefined),
      patchGlobal('clearTimeout', undefined)
    );

    const values: IdleDeadline[] = [];
    const sub = onIdle().subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]);
    sub.unsubscribe();
  });
});


