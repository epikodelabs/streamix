import { atom, DONE, scope, waitForDisposal } from '@epikodelabs/streamix';
import { createSSRApp, h } from 'vue';
import { renderToSimpleStream, renderToString } from '@vue/server-renderer';
import { useIterable } from '../lib/useIterable';
import { useScope } from '../lib/useScope';

describe('Vue SSR disposal', () => {
  it('awaits asynchronous cleanup through the SSR request context', async () => {
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const context = {};
    const app = createSSRApp({
      setup() {
        useIterable({
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<number>>(() => {}),
            return: async () => { started.resolve(); await release.promise; return DONE; },
          }),
        }, 0);
        return () => h('output', 'ready');
      },
    });
    expect(await renderToString(app, context)).toBe('<output>ready</output>');
    const completion = waitForDisposal(context);
    let done = false;
    void completion.then(() => { done = true; });
    await started.promise;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(done).toBeFalse();
    release.resolve();
    await completion;
    expect(done).toBeTrue();
  });

  it('unsubscribes bridged sources after renderToString', async () => {
    const shared = atom(0);
    const app = createSSRApp({
      setup() {
        const value = useIterable(shared, undefined, 'shared');
        return () => h('output', value.value);
      },
    });

    expect(await renderToString(app)).toBe('<output>0</output>');
    expect(shared.subscriberCount).toBe(0);

    // A module-level source bridged per request must not accumulate
    // subscribers across renders.
    shared.next(1);
    expect(await renderToString(app)).toBe('<output>1</output>');
    expect(shared.subscriberCount).toBe(0);

    shared.dispose();
  });

  it('closes a plain async iterator when rendering completes', async () => {
    let resolveNext!: (result: IteratorResult<number>) => void;
    let closed = false;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(resolve => { resolveNext = resolve; }),
          return: () => {
            closed = true;
            resolveNext({ done: true, value: undefined });
            return Promise.resolve({ done: true as const, value: undefined });
          },
        };
      },
    };

    const app = createSSRApp({
      setup() {
        const value = useIterable(source, 0);
        return () => h('output', value.value);
      },
    });

    expect(await renderToString(app)).toBe('<output>0</output>');
    expect(closed).toBeTrue();
  });

  it('unsubscribes bridged sources after a streaming render', async () => {
    const shared = atom(0);
    const app = createSSRApp({
      setup() {
        const value = useIterable(shared, undefined, 'shared');
        return () => h('output', value.value);
      },
    });

    const chunks: string[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      renderToSimpleStream(app, {}, {
        push(chunk: string | null) {
          if (chunk === null) resolve();
          else chunks.push(chunk);
        },
        destroy(error: unknown) {
          reject(error);
        },
      });
    });

    await completed;
    expect(chunks.join('')).toBe('<output>0</output>');
    expect(shared.subscriberCount).toBe(0);
    shared.dispose();
  });

  it('disposes compiler-owned Streamix scopes after renderToString', async () => {
    let state!: ReturnType<typeof scope>;

    const app = createSSRApp({
      setup() {
        state = useScope(() => scope({ title: 'Ready' }));
        return () => h('output', state.get('title').value);
      },
    });

    expect(await renderToString(app)).toBe('<output>Ready</output>');
    expect(state._disposed).toBeTrue();
  });

  it('releases bridges when rendering fails', async () => {
    // The rejection is the assertion; Vue's dev-mode warning for the
    // intentionally thrown render error is expected.
    const renderWarning = spyOn(console, 'warn');
    const shared = atom('ready');
    const app = createSSRApp({
      setup() {
        const value = useIterable(shared, undefined, 'shared');
        return () => {
          if (value.value) throw new Error('render failed');
          return null;
        };
      },
    });

    await expectAsync(renderToString(app)).toBeRejectedWithError('render failed');
    expect(renderWarning).toHaveBeenCalled();
    expect(shared.subscriberCount).toBe(0);
    shared.dispose();
  });
});
