import { scheduler } from '@actioncrew/streamix';
import { onVisibilityChange } from '@actioncrew/streamix/dom';
import { idescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/**
 * Patch helper that works in a real browser DOM.
 *
 * - For function-valued DOM methods (add/removeEventListener), define as VALUE.
 *   (Spies have length=0, so never infer based on .length)
 * - For "state" properties, define as GETTER.
 * - If patch value is `undefined`, DELETE the property.
 */
function patchObject(target: object, patch: Record<string, any>) {
  const originals: Record<string, PropertyDescriptor | undefined> = {};

  const forceValueKeys = new Set([
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
  ]);

  for (const key of Object.keys(patch)) {
    originals[key] = Object.getOwnPropertyDescriptor(target, key);
    const value = patch[key];

    // Remove property entirely
    if (value === undefined) {
      try {
        delete (target as any)[key];
      } catch {
        // Some DOM props are non-configurable; ignore.
      }
      continue;
    }

    // Force DOM methods to be callable values (NOT getters)
    if (forceValueKeys.has(key) && typeof value === 'function') {
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value,
      });
      continue;
    }

    // If caller gives a getter function, install as getter
    // (e.g., visibilityState: () => env.visibilityState)
    if (typeof value === 'function') {
      Object.defineProperty(target, key, {
        configurable: true,
        get: value,
      });
      continue;
    }

    // Otherwise treat it as a static value via getter
    Object.defineProperty(target, key, {
      configurable: true,
      get: () => value,
    });
  }

  return () => {
    for (const key of Object.keys(patch)) {
      const desc = originals[key];
      if (desc) {
        Object.defineProperty(target, key, desc);
      } else {
        try {
          delete (target as any)[key];
        } catch {
          // ignore non-configurable
        }
      }
    }
  };
}

/* -------------------------------------------------- */
/* Document mock                                      */
/* -------------------------------------------------- */

type Listener = () => void;

function mockVisibility(initial: DocumentVisibilityState = 'visible') {
  let state = initial;
  const listeners = new Set<Listener>();

  const addEventListener = jasmine
    .createSpy('document.addEventListener')
    .and.callFake((type: string, cb: Listener) => {
      if (type === 'visibilitychange') listeners.add(cb);
    });

  const removeEventListener = jasmine
    .createSpy('document.removeEventListener')
    .and.callFake((type: string, cb: Listener) => {
      if (type === 'visibilitychange') listeners.delete(cb);
    });

  return {
    get visibilityState(): DocumentVisibilityState {
      return state;
    },

    addEventListener,
    removeEventListener,

    setVisibility(next: DocumentVisibilityState) {
      state = next;
    },

    fire() {
      listeners.forEach((l) => l());
    },
  };
}

/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

idescribe('onVisibilityChange (browser)', () => {
  let restore: Array<() => void> = [];

  afterEach(async () => {
    restore.forEach((fn) => fn());
    restore = [];
    await flush();
  });

  it('emits initial visibility state on subscribe', async () => {
    const env = mockVisibility('hidden');

    restore.push(
      patchObject(document, {
        // LIVE getter
        visibilityState: () => env.visibilityState,
        // MUST be callable methods (values)
        addEventListener: env.addEventListener,
        removeEventListener: env.removeEventListener,
      })
    );

    const values: DocumentVisibilityState[] = [];
    const sub = onVisibilityChange().subscribe((v) => values.push(v));
    await flush();

    expect(values).toEqual(['hidden']);
    sub.unsubscribe();
  });

  it('emits on visibilitychange events', async () => {
    const env = mockVisibility('visible');

    restore.push(
      patchObject(document, {
        visibilityState: () => env.visibilityState,
        addEventListener: env.addEventListener,
        removeEventListener: env.removeEventListener,
      })
    );

    const values: DocumentVisibilityState[] = [];
    const sub = onVisibilityChange().subscribe((v) => values.push(v));
    await flush();

    env.setVisibility('hidden');
    env.fire();
    await flush();

    env.setVisibility('visible');
    env.fire();
    await flush();

    expect(values).toEqual(['visible', 'hidden', 'visible']);
    sub.unsubscribe();
  });

  it('adds listener once and removes on last unsubscribe', async () => {
    const env = mockVisibility('visible');

    restore.push(
      patchObject(document, {
        visibilityState: () => env.visibilityState,
        addEventListener: env.addEventListener,
        removeEventListener: env.removeEventListener,
      })
    );

    const stream = onVisibilityChange();

    const s1 = stream.subscribe();
    const s2 = stream.subscribe();
    await flush();

    expect(env.addEventListener).toHaveBeenCalledTimes(1);

    s1.unsubscribe();
    s2.unsubscribe();
    await flush();

    expect(env.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('supports async iteration', async () => {
    const env = mockVisibility('visible');

    restore.push(
      patchObject(document, {
        visibilityState: () => env.visibilityState,
        addEventListener: env.addEventListener,
        removeEventListener: env.removeEventListener,
      })
    );

    const iter = (async () => {
      const out: DocumentVisibilityState[] = [];
      for await (const v of onVisibilityChange()) {
        out.push(v);
        if (out.length === 3) break;
      }
      return out;
    })();

    await flush();

    env.setVisibility('hidden');
    env.fire();
    await flush();

    env.setVisibility('visible');
    env.fire();
    await flush();

    expect(await iter).toEqual(['visible', 'hidden', 'visible']);
  });
});
