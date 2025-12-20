import { scheduler } from '@actioncrew/streamix';

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
