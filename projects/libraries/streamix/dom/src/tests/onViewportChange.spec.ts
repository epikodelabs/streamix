import { scheduler } from '@actioncrew/streamix';
import { onViewportChange } from '@actioncrew/streamix/dom';
import { idescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/**
 * Browser-safe patch helper with dynamic getters.
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
/* visualViewport mock                                */
/* -------------------------------------------------- */

type Listener = () => void;

function mockViewport(width = 800, height = 600) {
  let w = width;
  let h = height;

  const listeners = new Set<Listener>();

  const visualViewport = {
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    scale: 1,
    offsetLeft: 0,
    offsetTop: 0,

    addEventListener: jasmine
      .createSpy('visualViewport.addEventListener')
      .and.callFake((_type: string, cb: Listener) => {
        listeners.add(cb);
      }),

    removeEventListener: jasmine
      .createSpy('visualViewport.removeEventListener')
      .and.callFake((_type: string, cb: Listener) => {
        listeners.delete(cb);
      }),
  };

  return {
    visualViewport,

    get innerWidth() {
      return w;
    },

    get innerHeight() {
      return h;
    },

    resize(nextW: number, nextH: number) {
      w = nextW;
      h = nextH;
      listeners.forEach(l => l());
    },
  };
}

/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

idescribe('onViewportChange', () => {
  let restore: (() => void)[] = [];

  afterEach(() => {
    restore.forEach(fn => fn());
    restore = [];
  });

  it('emits initial viewport state on subscribe', async () => {
    const env = mockViewport(1024, 768);

    restore.push(
      patchObject(window, {
        visualViewport: env.visualViewport,
        innerWidth: () => env.innerWidth,
        innerHeight: () => env.innerHeight,
      })
    );

    const values: any[] = [];
    const sub = onViewportChange().subscribe(v => values.push(v));
    await flush();

    expect(values[0]).toEqual(
      jasmine.objectContaining({
        width: 1024,
        height: 768,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
      })
    );

    sub.unsubscribe();
  });

  it('emits on viewport resize', async () => {
    const env = mockViewport(800, 600);

    restore.push(
      patchObject(window, {
        visualViewport: env.visualViewport,
        innerWidth: () => env.innerWidth,
        innerHeight: () => env.innerHeight,
      })
    );

    const values: any[] = [];
    const sub = onViewportChange().subscribe(v => values.push(v));
    await flush();

    env.resize(1280, 720);
    await flush();

    expect(values[1]).toEqual(
      jasmine.objectContaining({
        width: 1280,
        height: 720,
      })
    );

    sub.unsubscribe();
  });

  it('adds visualViewport listeners on start', async () => {
    const env = mockViewport();

    restore.push(
      patchObject(window, {
        visualViewport: env.visualViewport,
      })
    );

    const sub = onViewportChange().subscribe();
    await flush();

    expect(env.visualViewport.addEventListener).toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('removes visualViewport listeners on stop', async () => {
    const env = mockViewport();

    restore.push(
      patchObject(window, {
        visualViewport: env.visualViewport,
      })
    );

    const sub = onViewportChange().subscribe();
    await flush();

    sub.unsubscribe();
    await flush();

    expect(env.visualViewport.removeEventListener).toHaveBeenCalled();
  });

  it('supports async iteration', async () => {
    const env = mockViewport(500, 400);

    restore.push(
      patchObject(window, {
        visualViewport: env.visualViewport,
        innerWidth: () => env.innerWidth,
        innerHeight: () => env.innerHeight,
      })
    );

    const iter = (async () => {
      const out: any[] = [];
      for await (const v of onViewportChange()) {
        out.push(v);
        if (out.length === 2) break;
      }
      return out;
    })();

    await flush();
    env.resize(600, 500);
    await flush();

    const values = await iter;

    expect(values[0]).toEqual(
      jasmine.objectContaining({ width: 500, height: 400 })
    );
    expect(values[1]).toEqual(
      jasmine.objectContaining({ width: 600, height: 500 })
    );
  });

  it('is SSR-safe when visualViewport is unavailable', async () => {
    restore.push(
      patchObject(window, {
        visualViewport: undefined,
      })
    );

    const values: any[] = [];
    const sub = onViewportChange().subscribe(v => values.push(v));
    await flush();

    // Snapshot still emitted using innerWidth / innerHeight
    expect(values.length).toBe(1);
    sub.unsubscribe();
  });
});
