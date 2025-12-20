import { scheduler } from '@actioncrew/streamix';
import { onFullscreen } from '@actioncrew/streamix/dom';
import { ndescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/* -------------------------------------------------- */
/* Global patch helper (CRITICAL)                      */
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
/* Fullscreen mock                                    */
/* -------------------------------------------------- */

type Listener = () => void;

function mockFullscreenEnv(initialFullscreen = false) {
  let fullscreen = initialFullscreen;

  const listeners = new Set<Listener>();

  const doc = {
    get fullscreenElement() {
      return fullscreen ? {} : null;
    },

    addEventListener: jasmine
      .createSpy('document.addEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (type === 'fullscreenchange') listeners.add(cb);
      }),

    removeEventListener: jasmine
      .createSpy('document.removeEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (type === 'fullscreenchange') listeners.delete(cb);
      }),
  } as unknown as Document;

  return {
    document: doc,

    enter() {
      fullscreen = true;
      listeners.forEach(l => l());
    },

    exit() {
      fullscreen = false;
      listeners.forEach(l => l());
    },
  };
}

/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

ndescribe('onFullscreen', () => {
  let restoreDocument: () => void;

  afterEach(() => {
    restoreDocument?.();
  });

  /* -------------------------------------------------- */
  /* Basic behavior                                     */
  /* -------------------------------------------------- */

  it('emits initial fullscreen state on subscribe', async () => {
    const env = mockFullscreenEnv(false);
    restoreDocument = defineGlobal('document', env.document);

    const values: boolean[] = [];
    const stream = onFullscreen();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([false]);

    sub.unsubscribe();
  });

  it('emits true when entering fullscreen', async () => {
    const env = mockFullscreenEnv(false);
    restoreDocument = defineGlobal('document', env.document);

    const values: boolean[] = [];
    const stream = onFullscreen();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.enter();
    await flush();

    expect(values).toEqual([false, true]);

    sub.unsubscribe();
  });

  it('emits false when exiting fullscreen', async () => {
    const env = mockFullscreenEnv(true);
    restoreDocument = defineGlobal('document', env.document);

    const values: boolean[] = [];
    const stream = onFullscreen();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.exit();
    await flush();

    expect(values).toEqual([true, false]);

    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Listener lifecycle                                 */
  /* -------------------------------------------------- */

  it('adds listener on start and removes on stop', async () => {
    const env = mockFullscreenEnv(false);
    restoreDocument = defineGlobal('document', env.document);

    const stream = onFullscreen();

    const sub = stream.subscribe();
    await flush();

    expect(env.document.addEventListener).toHaveBeenCalledWith(
      'fullscreenchange',
      jasmine.any(Function)
    );

    sub.unsubscribe();
    await flush();

    expect(env.document.removeEventListener).toHaveBeenCalledWith(
      'fullscreenchange',
      jasmine.any(Function)
    );
  });

  /* -------------------------------------------------- */
  /* Async iteration                                    */
  /* -------------------------------------------------- */

  it('supports async iteration', async () => {
    const env = mockFullscreenEnv(false);
    restoreDocument = defineGlobal('document', env.document);

    const stream = onFullscreen();

    const iter = (async () => {
      const out: boolean[] = [];
      for await (const v of stream) {
        out.push(v);
        if (out.length === 2) break;
      }
      return out;
    })();

    await flush();

    env.enter();
    await flush();

    const values = await iter;

    expect(values).toEqual([false, true]);
  });

  /* -------------------------------------------------- */
  /* SSR safety                                         */
  /* -------------------------------------------------- */

  it('is SSR-safe when document is undefined', async () => {
    restoreDocument = defineGlobal('document', undefined);

    const values: boolean[] = [];
    const stream = onFullscreen();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]); // silent in SSR

    sub.unsubscribe();
  });

  /* -------------------------------------------------- */
  /* Graceful degradation                               */
  /* -------------------------------------------------- */

  it('works when Fullscreen API is unavailable but document exists', async () => {
    const listeners = new Set<() => void>();

    const doc = {
      addEventListener: jasmine
        .createSpy('document.addEventListener')
        .and.callFake((_type: string, cb: () => void) => {
          listeners.add(cb);
        }),

      removeEventListener: jasmine
        .createSpy('document.removeEventListener')
        .and.callFake((_type: string, cb: () => void) => {
          listeners.delete(cb);
      }),

      // Fullscreen API is "unavailable"
      fullscreenElement: undefined,
    } as unknown as Document;

    restoreDocument = defineGlobal('document', doc);

    const values: boolean[] = [];
    const stream = onFullscreen();

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    // Emits initial state (false)
    expect(values).toEqual([false]);

    sub.unsubscribe();
  });
});
