import { scheduler } from '@actioncrew/streamix';
import { onVisibilityChange } from '@actioncrew/streamix/dom';
import { ndescribe } from './env.spec';

/* -------------------------------------------------- */
/* Helpers                                            */
/* -------------------------------------------------- */

async function flush() {
  await scheduler.flush();
}

/* -------------------------------------------------- */
/* Document mock                                      */
/* -------------------------------------------------- */

type Listener = () => void;

function mockDocument(initial: DocumentVisibilityState = 'visible') {
  let state = initial;
  const listeners = new Set<Listener>();

  const doc = {
    get visibilityState() {
      return state;
    },

    addEventListener: jasmine.createSpy('addEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (type === 'visibilitychange') listeners.add(cb);
      }),

    removeEventListener: jasmine.createSpy('removeEventListener')
      .and.callFake((type: string, cb: Listener) => {
        if (type === 'visibilitychange') listeners.delete(cb);
      }),
  } as unknown as Document;

  return {
    document: doc,

    setVisibility(next: DocumentVisibilityState) {
      state = next;
    },

    fireVisibilityChange() {
      listeners.forEach(l => l());
    },
  };
}


/* -------------------------------------------------- */
/* Tests                                              */
/* -------------------------------------------------- */

ndescribe('onVisibilityChange', () => {
  let originalDocument: any;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  it('emits initial visibility state on subscribe', async () => {
    const env = mockDocument('hidden');
    (globalThis as any).document = env.document;

    const stream = onVisibilityChange();
    const values: DocumentVisibilityState[] = [];

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual(['hidden']);
    sub.unsubscribe();
  });

  it('emits on visibilitychange events', async () => {
    const env = mockDocument('visible');
    (globalThis as any).document = env.document;

    const stream = onVisibilityChange();
    const values: DocumentVisibilityState[] = [];

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    env.setVisibility('hidden');
    env.fireVisibilityChange();
    await flush();

    env.setVisibility('visible');
    env.fireVisibilityChange();
    await flush();

    expect(values).toEqual(['visible', 'hidden', 'visible']);
    sub.unsubscribe();
  });

  it('adds listener only once and removes on last unsubscribe', async () => {
    const env = mockDocument();
    (globalThis as any).document = env.document;

    const stream = onVisibilityChange();

    const s1 = stream.subscribe();
    const s2 = stream.subscribe();
    await flush();

    expect(env.document.addEventListener).toHaveBeenCalledTimes(1);

    s1.unsubscribe();
    s2.unsubscribe();
    await flush();

    expect(env.document.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('supports async iteration', async () => {
    const env = mockDocument('visible');
    (globalThis as any).document = env.document;

    const stream = onVisibilityChange();

    const iter = (async () => {
      const out: DocumentVisibilityState[] = [];
      for await (const v of stream) {
        out.push(v);
        if (out.length === 3) break;
      }
      return out;
    })();

    await flush();

    env.setVisibility('hidden');
    env.fireVisibilityChange();
    await flush();

    env.setVisibility('visible');
    env.fireVisibilityChange();
    await flush();

    expect(await iter).toEqual(['visible', 'hidden', 'visible']);
  });

  it('is SSR-safe when document is undefined', async () => {
    delete (globalThis as any).document;

    const stream = onVisibilityChange();
    const values: DocumentVisibilityState[] = [];

    const sub = stream.subscribe(v => values.push(v));
    await flush();

    expect(values).toEqual([]);
    sub.unsubscribe();
  });
});

