import { scheduler } from '@actioncrew/streamix';
import { type NetworkState, onNetwork } from '@actioncrew/streamix/dom';
import { idescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/**
 * Browser-safe patch helper.
 * - Preserves object identity
 * - Uses getters (DOM-correct)
 * - Restores descriptors exactly
 */
function patchObject(
  target: object,
  patch: Record<string, any>
) {
  const originals: Record<string, PropertyDescriptor | undefined> = {};

  for (const key of Object.keys(patch)) {
    originals[key] = Object.getOwnPropertyDescriptor(target, key);
    const value = patch[key];

    Object.defineProperty(target, key, {
      configurable: true,
      get: typeof value === 'function'
        ? value
        : () => value,
    });
  }

  return () => {
    for (const key of Object.keys(patch)) {
      const desc = originals[key];
      if (desc) {
        Object.defineProperty(target, key, desc);
      } else {
        delete (target as any)[key];
      }
    }
  };
}

/* -------------------------------------------------- */
/* Network mock                                       */
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

  const addEventListener = jasmine
    .createSpy('window.addEventListener')
    .and.callFake((type: string, cb: Listener) => {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, new Set());
      }
      windowListeners.get(type)!.add(cb);
    });

  const removeEventListener = jasmine
    .createSpy('window.removeEventListener')
    .and.callFake((type: string, cb: Listener) => {
      windowListeners.get(type)?.delete(cb);
    });

  return {
    connection,
    addEventListener,
    removeEventListener,

    get onLine() {
      return online;
    },

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

idescribe('onNetwork', () => {
  let restore: (() => void)[] = [];

  afterEach(() => {
    restore.forEach(fn => fn());
    restore = [];
  });

  it('emits initial network snapshot on subscribe', async () => {
    const env = mockNetworkEnv(true);

    restore.push(
      patchObject(window, {
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
      }),
      patchObject(navigator as any, {
        onLine: () => env.onLine,
        connection: env.connection,
      })
    );

    const values: NetworkState[] = [];
    const sub = onNetwork().subscribe(v => values.push(v));
    await flush();

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

  it('emits on online / offline events', async () => {
    const env = mockNetworkEnv(true);

    restore.push(
      patchObject(window, {
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
      }),
      patchObject(navigator as any, {
        onLine: () => env.onLine,
        connection: env.connection,
      })
    );

    const values: NetworkState[] = [];
    const sub = onNetwork().subscribe(v => values.push(v));
    await flush();

    env.setOnline(false);
    await flush();

    env.setOnline(true);
    await flush();

    expect(values.map(v => v.online)).toEqual([true, false, true]);
    sub.unsubscribe();
  });

  it('supports async iteration', async () => {
    const env = mockNetworkEnv(true);

    restore.push(
      patchObject(window, {
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
      }),
      patchObject(navigator as any, {
        onLine: () => env.onLine,
        connection: env.connection,
      })
    );

    const iter = (async () => {
      const out: NetworkState[] = [];
      for await (const v of onNetwork()) {
        out.push(v);
        if (out.length === 2) break;
      }
      return out;
    })();

    await flush();
    env.setOnline(false);
    await flush();

    expect((await iter).map(v => v.online)).toEqual([true, false]);
  });

  it('is SSR-safe when APIs are missing (no crash)', async () => {
    restore.push(
      patchObject(window, {
        addEventListener: () => () => {},
        removeEventListener: () => () => {},
      }),
      patchObject(navigator as any, {
        onLine: () => undefined,
        connection: undefined,
      })
    );

    const values: NetworkState[] = [];
    const sub = onNetwork().subscribe(v => values.push(v));
    await flush();

    expect(values.length).toBe(1); // snapshot still emitted
    sub.unsubscribe();
  });
});
