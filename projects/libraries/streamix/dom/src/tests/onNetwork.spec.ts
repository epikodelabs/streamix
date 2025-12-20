import { scheduler } from '@actioncrew/streamix';
import { NetworkState, onNetwork } from '@actioncrew/streamix/dom';
import { ndescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/* -------------------------------------------------- */
/* Global patch helpers (CRITICAL)                     */
/* -------------------------------------------------- */

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
/* Window / Navigator mock                             */
/* -------------------------------------------------- */

type Listener = () => void;

function mockNetworkEnv(initialOnline = true) {
  let online = initialOnline;

  const windowListeners = new Map<string, Set<Listener>>();
  const connectionListeners = new Set<Listener>();

  const connection = {
    type: 'wifi',
    effectiveType: '4g',
    downlink: 10,
    rtt: 50,
    saveData: false,

    addEventListener: jasmine
      .createSpy('connection.addEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (type === 'change') connectionListeners.add(cb);
      }),

    removeEventListener: jasmine
      .createSpy('connection.removeEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (type === 'change') connectionListeners.delete(cb);
      }),
  };

  const win = {
    addEventListener: jasmine
      .createSpy('window.addEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (!windowListeners.has(type)) {
          windowListeners.set(type, new Set());
        }
        windowListeners.get(type)!.add(cb);
      }),

    removeEventListener: jasmine
      .createSpy('window.removeEventListener')
      .and.callFake((type: string, cb: Listener) => {
        windowListeners.get(type)?.delete(cb);
      }),
  } as unknown as Window;

  const nav = {
    get onLine() {
      return online;
    },
    connection,
  } as unknown as Navigator;

  return {
    window: win,
    navigator: nav,
    connection,

    setOnline(next: boolean) {
      online = next;
      windowListeners.get(next ? 'online' : 'offline')?.forEach(l => l());
    },

    fireConnectionChange() {
      connectionListeners.forEach(l => l());
    },
  };
}

/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

ndescribe('onNetwork', () => {
  let restoreWindow: () => void;
  let restoreNavigator: () => void;

  afterEach(() => {
    restoreWindow?.();
    restoreNavigator?.();
  });

  /* -------------------------------------------------- */
  /* Basic behavior                                     */
  /* -------------------------------------------------- */

  it('emits initial network snapshot on subscribe', async () => {
    const env = mockNetworkEnv(true);

    restoreWindow = defineGlobal('window', env.window);
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const values: NetworkState[] = [];
    const stream = onNetwork();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values.length).toBe(1);
    expect(values[0]).toEqual(
      jasmine.objectContaining({
        online: true,
        type: 'wifi',
        effectiveType: '4g',
        downlink: 10,
        rtt: 50,
        saveData: false,
      })
    );

    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Online / Offline                                   */
  /* -------------------------------------------------- */

  it('emits on online / offline events', async () => {
    const env = mockNetworkEnv(true);

    restoreWindow = defineGlobal('window', env.window);
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const values: NetworkState[] = [];
    const stream = onNetwork();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.setOnline(false);
    await flush();

    env.setOnline(true);
    await flush();

    expect(values.map(v => v.online)).toEqual([true, false, true]);

    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Network Information API                            */
  /* -------------------------------------------------- */

  it('emits on connection change events', async () => {
    const env = mockNetworkEnv(true);

    restoreWindow = defineGlobal('window', env.window);
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const values: NetworkState[] = [];
    const stream = onNetwork();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.connection.downlink = 5;
    env.connection.effectiveType = '3g';
    env.fireConnectionChange();
    await flush();

    expect(values.length).toBe(2);
    expect(values[1]).toEqual(
      jasmine.objectContaining({
        online: true,
        effectiveType: '3g',
        downlink: 5,
      })
    );

    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Listener lifecycle                                 */
  /* -------------------------------------------------- */

  it('adds listeners on start and removes on stop', async () => {
    const env = mockNetworkEnv(true);

    restoreWindow = defineGlobal('window', env.window);
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const stream = onNetwork();

    const sub = stream.subscribe();
    await flush();

    expect(env.window.addEventListener).toHaveBeenCalled();
    expect(env.connection.addEventListener).toHaveBeenCalled();

    sub.unsubscribe();
    await flush();

    expect(env.window.removeEventListener).toHaveBeenCalled();
    expect(env.connection.removeEventListener).toHaveBeenCalled();
  });

  /* -------------------------------------------------- */
  /* Async iteration                                    */
  /* -------------------------------------------------- */

  it('supports async iteration', async () => {
    const env = mockNetworkEnv(true);

    restoreWindow = defineGlobal('window', env.window);
    restoreNavigator = defineGlobal('navigator', env.navigator);

    const stream = onNetwork();

    const iter = (async () => {
      const out: NetworkState[] = [];
      for await (const v of stream) {
        out.push(v);
        if (out.length === 2) break;
      }
      return out;
    })();

    await flush();

    env.setOnline(false);
    await flush();

    const values = await iter;

    expect(values.map(v => v.online)).toEqual([true, false]);
  });

  /* -------------------------------------------------- */
  /* SSR safety                                         */
  /* -------------------------------------------------- */

  it('is SSR-safe when window or navigator is undefined', async () => {
    restoreWindow = defineGlobal('window', undefined);
    restoreNavigator = defineGlobal('navigator', undefined);

    const values: NetworkState[] = [];
    const stream = onNetwork();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]);
    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Graceful degradation                               */
  /* -------------------------------------------------- */

  it('works without Network Information API', async () => {
    const env = mockNetworkEnv(true);

    restoreWindow = defineGlobal('window', env.window);
    restoreNavigator = defineGlobal('navigator', {
      get onLine() {
        return true;
      },
    });

    const values: NetworkState[] = [];
    const stream = onNetwork();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values[0]).toEqual(
      jasmine.objectContaining({
        online: true,
        type: undefined,
        effectiveType: undefined,
      })
    );

    sub.unsubscribe();
  });
});
