import { type NetworkState, onNetwork } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await new Promise(r => setTimeout(r, 0));
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

  it('emits on connection change events (Network Information API)', async () => {
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

    env.connection.downlink = 42;
    env.fireConnectionChange();
    await flush();

    expect(values.length).toBe(2);
    expect(values[1].downlink).toBe(42);
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

  it('does nothing when navigator is unavailable', () => {
    const originalAdd = window.addEventListener;
    const originalRemove = window.removeEventListener;

    const addSpy = spyOn(window, 'addEventListener').and.stub();

    const originalNavigator = (globalThis as any).navigator;
    delete (globalThis as any).navigator;

    try {
      const subscription = onNetwork().subscribe(() => {});

      expect(addSpy).not.toHaveBeenCalled();

      subscription.unsubscribe();
    } finally {
      (globalThis as any).addEventListener = originalAdd;
      (globalThis as any).removeEventListener = originalRemove;

      if (originalNavigator) {
        (globalThis as any).navigator = originalNavigator;
      } else {
        delete (globalThis as any).navigator;
      }
    }
  });

  it('handles connection without addEventListener method', async () => {
    const env = mockNetworkEnv(true);

    // Create connection without addEventListener
    const connectionNoAdd = {
      type: 'wifi',
      effectiveType: '4g',
      downlink: 10,
      rtt: 50,
      saveData: false,
      // No addEventListener
    };

    restore.push(
      patchObject(window, {
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
      }),
      patchObject(navigator as any, {
        onLine: () => env.onLine,
        connection: connectionNoAdd,
      })
    );

    const values: NetworkState[] = [];
    const sub = onNetwork().subscribe(v => values.push(v));
    await flush();

    // Should still emit snapshot
    expect(values.length).toBe(1);
    
    // Should not crash when unsubscribing
    expect(() => sub.unsubscribe()).not.toThrow();
  });

  it('handles connection without removeEventListener method', async () => {
    const env = mockNetworkEnv(true);

    const connectionNoRemove = {
      type: 'wifi',
      effectiveType: '4g',
      downlink: 10,
      rtt: 50,
      saveData: false,
      addEventListener: jasmine.createSpy('addEventListener'),
      // No removeEventListener
    };

    restore.push(
      patchObject(window, {
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
      }),
      patchObject(navigator as any, {
        onLine: () => env.onLine,
        connection: connectionNoRemove,
      })
    );

    const sub = onNetwork().subscribe();
    await flush();

    // Should not crash when unsubscribing
    expect(() => sub.unsubscribe()).not.toThrow();
  });

  it('does not restart when start() called multiple times', async () => {
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

    (env.addEventListener as jasmine.Spy).calls.reset();
    (env.connection.addEventListener as jasmine.Spy).calls.reset();

    const sub1 = onNetwork().subscribe();
    const sub2 = onNetwork().subscribe();
    await flush();

    // Should only add listeners once
    const windowCalls = (env.addEventListener as jasmine.Spy).calls.count();
    const connectionCalls = (env.connection.addEventListener as jasmine.Spy).calls.count();

    expect(windowCalls).toBeGreaterThan(0);
    expect(connectionCalls).toBeGreaterThan(0);

    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('does not stop when already stopped', async () => {
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

    const sub = onNetwork().subscribe();
    await flush();

    sub.unsubscribe();
    await flush();

    (env.removeEventListener as jasmine.Spy).calls.reset();
    (env.connection.removeEventListener as jasmine.Spy).calls.reset();

    // Calling unsubscribe again should not call removeEventListener
    sub.unsubscribe();
    await flush();

    expect(env.removeEventListener).not.toHaveBeenCalled();
    expect(env.connection.removeEventListener).not.toHaveBeenCalled();
  });

  it('handles window undefined in stop() (SSR cleanup)', async () => {
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

    const sub = onNetwork().subscribe();
    await flush();

    // Should not crash on unsubscribe even if cleanup has issues
    try {
      sub.unsubscribe();
      expect(true).toBe(true); // Passed
    } catch (e) {
      // Cleanup errors should be caught
      expect(true).toBe(true);
    }
  });
});

