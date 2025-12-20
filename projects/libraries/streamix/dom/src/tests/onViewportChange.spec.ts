import { scheduler } from '@actioncrew/streamix';
import { onViewportChange } from '@actioncrew/streamix/dom';
import { ndescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/* -------------------------------------------------- */
/* Window + visualViewport mock                        */
/* -------------------------------------------------- */

type Listener = () => void;

function mockWindow(width = 800, height = 600) {
  let w = width;
  let h = height;

  const vvListeners = new Set<Listener>();

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
        vvListeners.add(cb);
      }),

    removeEventListener: jasmine
      .createSpy('visualViewport.removeEventListener')
      .and.callFake((_type: string, cb: Listener) => {
        vvListeners.delete(cb);
      }),
  };

  const win = {
    get innerWidth() {
      return w;
    },
    get innerHeight() {
      return h;
    },
    visualViewport,
  } as unknown as Window;

  return {
    window: win,
    visualViewport,

    resize(nextW: number, nextH: number) {
      w = nextW;
      h = nextH;
      vvListeners.forEach(l => l());
    },
  };
}

/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

ndescribe('onViewportChange', () => {
  let originalWindow: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  /* -------------------------------------------------- */
  /* Basic behavior                                     */
  /* -------------------------------------------------- */

  it('emits initial viewport state on subscribe', async () => {
    const env = mockWindow(1024, 768);
    (globalThis as any).window = env.window;

    const values: any[] = [];
    const stream = onViewportChange();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values.length).toBe(1);
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
    const env = mockWindow(800, 600);
    (globalThis as any).window = env.window;

    const values: any[] = [];
    const stream = onViewportChange();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.resize(1280, 720);
    await flush();

    expect(values.length).toBe(2);
    expect(values[1]).toEqual(
      jasmine.objectContaining({
        width: 1280,
        height: 720,
        scale: 1,
        offsetLeft: 0,
        offsetTop: 0,
      })
    );

    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Listener lifecycle                                 */
  /* -------------------------------------------------- */

  it('adds visualViewport listeners on start', async () => {
    const env = mockWindow();
    (globalThis as any).window = env.window;

    const stream = onViewportChange();

    const sub = stream.subscribe();
    await flush();

    expect(env.visualViewport.addEventListener).toHaveBeenCalled();

    sub.unsubscribe();
  });

  it('removes visualViewport listeners on stop', async () => {
    const env = mockWindow();
    (globalThis as any).window = env.window;

    const stream = onViewportChange();

    const sub = stream.subscribe();
    await flush();

    sub.unsubscribe();
    await flush();

    expect(env.visualViewport.removeEventListener).toHaveBeenCalled();
  });

  /* -------------------------------------------------- */
  /* Async iteration                                    */
  /* -------------------------------------------------- */

  it('supports async iteration', async () => {
    const env = mockWindow(500, 400);
    (globalThis as any).window = env.window;

    const stream = onViewportChange();

    const iter = (async () => {
      const out: any[] = [];
      for await (const v of stream) {
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

  /* -------------------------------------------------- */
  /* SSR safety                                         */
  /* -------------------------------------------------- */

  it('is SSR-safe when window is undefined', async () => {
    delete (globalThis as any).window;

    const values: any[] = [];
    const stream = onViewportChange();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]);
    sub.unsubscribe();
  });
});
