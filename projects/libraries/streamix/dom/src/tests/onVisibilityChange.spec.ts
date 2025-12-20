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
 * Browser-safe patch helper
 * - always uses getters
 * - never deletes DOM methods
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
/* Document mock                                      */
/* -------------------------------------------------- */

type Listener = () => void;

function mockVisibility(initial: DocumentVisibilityState = 'visible') {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    get visibilityState(): DocumentVisibilityState {
      return state;
    },

    addEventListener: jasmine
      .createSpy('document.addEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (type === 'visibilitychange') listeners.add(cb);
      }),

    removeEventListener: jasmine
      .createSpy('document.removeEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (type === 'visibilitychange') listeners.delete(cb);
      }),

    setVisibility(next: DocumentVisibilityState) {
      state = next;
    },

    fire() {
      listeners.forEach(l => l());
    },
  };
}

/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

idescribe('onVisibilityChange (browser)', () => {
  let restore: (() => void)[] = [];

  afterEach(() => {
    restore.forEach(fn => fn());
    restore = [];
  });

  it('emits initial visibility state on subscribe', async () => {
    const env = mockVisibility('hidden');

    restore.push(
      patchObject(document, {
        visibilityState: () => env.visibilityState,
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
      })
    );

    const values: DocumentVisibilityState[] = [];
    const sub = onVisibilityChange().subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual(['hidden']);
    sub.unsubscribe();
  });

  it('emits on visibilitychange events', async () => {
    const env = mockVisibility('visible');

    restore.push(
      patchObject(document, {
        visibilityState: () => env.visibilityState,
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
      })
    );

    const values: DocumentVisibilityState[] = [];
    const sub = onVisibilityChange().subscribe(v => values.push(v));
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
    const env = mockVisibility();

    restore.push(
      patchObject(document, {
        visibilityState: () => env.visibilityState,
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
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
        addEventListener: () => env.addEventListener,
        removeEventListener: () => env.removeEventListener,
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

  it('is SSR-safe when visibility API is missing (no crash)', async () => {
    restore.push(
      patchObject(document, {
        visibilityState: () => undefined,
        addEventListener: () => {},
        removeEventListener: () => {},
      })
    );

    const values: (DocumentVisibilityState | undefined)[] = [];
    const sub = onVisibilityChange().subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([undefined]);
    sub.unsubscribe();
  });
});
