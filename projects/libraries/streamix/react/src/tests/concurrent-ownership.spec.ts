import { act, createElement, startTransition, StrictMode, Suspense, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { atom, scope, type Writable } from '@epikodelabs/streamix';
import { internalRuntime } from '../../../src/lib/runtime/runtime';
import {
  createStreamixLifetime, StreamixLifetimeProvider, useAtomValue, usePreloadedResource, useStreamixLocal,
  type PreloadedResource,
} from '../lib/runtime';
import { idescribe } from './env.spec';

const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

idescribe('React concurrent ownership', () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); await nextTask(); host.remove(); });

  for (const explicitLifetime of [false, true]) {
    it(`releases abandoned concurrent atoms/scopes (lifetime ${explicitLifetime})`, async () => {
      const baseline = internalRuntime.graph.size;
      const lifetime = createStreamixLifetime();
      const retained = spyOn(lifetime, 'retain').and.callThrough();
      const created: Writable<number>[] = [];
      const scopes: ReturnType<typeof scope<{ count: number }>>[] = [];
      const pending = new Promise<never>(() => {});
      function Abandoned(): never {
        const count = useStreamixLocal(() => { const value = atom(1); created.push(value); return value; });
        const state = useStreamixLocal(() => { const value = scope({ count: 1 }); scopes.push(value); return value; });
        useAtomValue(count);
        void state.count;
        throw pending;
      }
      await act(async () => root.render(createElement('p', null, 'current')));
      const suspended = createElement(Suspense, { fallback: 'waiting' }, createElement(Abandoned));
      await act(async () => startTransition(() => root.render(explicitLifetime
        ? createElement(StreamixLifetimeProvider, { lifetime }, suspended)
        : suspended,
      )));
      expect(created.length).toBeGreaterThan(0);
      await nextTask();
      await act(async () => root.render(createElement('p', null, 'cancelled')));
      await nextTask();
      expect(created.every(value => value.disposed)).toBeTrue();
      expect(scopes.every(value => value._disposed)).toBeTrue();
      expect(retained).not.toHaveBeenCalled();
      expect(internalRuntime.graph.size).toBe(baseline);
      lifetime.dispose();
    });
  }

  it('keeps StrictMode commits alive until unmount', async () => {
    const created: Writable<number>[] = [];
    function Committed() {
      const count = useStreamixLocal(() => { const value = atom(1); created.push(value); return value; });
      return createElement('output', null, useAtomValue(count));
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(Committed))));
    await nextTask();
    const live = created.filter(value => !value.disposed);
    expect(live.length).toBe(1);
    await act(async () => live[0].next(2));
    expect(host.textContent).toBe('2');
    await act(async () => root.unmount());
    expect(created.every(value => value.disposed)).toBeTrue();
    root = createRoot(host);
  });

  it('retries a suspended mount with fresh live instances after provisional cleanup', async () => {
    let resume!: () => void;
    let ready = false;
    const pending = new Promise<void>(resolve => { resume = resolve; });
    const created: Writable<number>[] = [];
    function View() {
      const count = useStreamixLocal(() => { const value = atom(3); created.push(value); return value; });
      const value = useAtomValue(count);
      if (!ready) throw pending;
      return createElement('output', null, value);
    }
    await act(async () => root.render(createElement(Suspense, { fallback: 'waiting' }, createElement(View))));
    await nextTask();
    expect(created.every(value => value.disposed)).toBeTrue();
    await act(async () => { ready = true; resume(); await pending; });
    await nextTask();
    expect(host.textContent).toBe('3');
    expect(created.filter(value => !value.disposed).length).toBe(1);
  });

  function externalResource() {
    let status: 'pending' | 'ready' = 'pending';
    let data: number | undefined;
    let statusReads = 0;
    const listeners = new Set<() => void>();
    const resource: PreloadedResource<number> = {
      get status() { statusReads++; return status; },
      get data() { return data; },
      error: undefined, disposed: false,
      read() { return data!; }, preload() {}, reload() {}, dispose() { listeners.clear(); },
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    return {
      resource,
      publish(value: number) { status = 'ready'; data = value; for (const listener of listeners) listener(); },
      get reads() { return statusReads; }, reset() { statusReads = 0; },
    };
  }

  it('keeps repeated resource snapshot reads pure and publishes same-status data changes', async () => {
    const external = externalResource();
    let renders = 0;
    function View() { renders++; const resource = usePreloadedResource(external.resource); return createElement('output', null, resource.data); }
    await act(async () => root.render(createElement(View)));
    external.reset();
    for (let index = 0; index < 3; index++) await act(async () => root.render(createElement(View)));
    expect(external.reads).toBe(0);
    await act(async () => external.publish(1));
    expect(host.textContent).toBe('1');
    await act(async () => external.publish(2));
    expect(host.textContent).toBe('2');
    const before = renders;
    await act(async () => external.publish(2));
    expect(renders).toBe(before);
  });

  it('observes a resource change between render and subscription', async () => {
    const external = externalResource();
    function View() {
      const resource = usePreloadedResource(external.resource);
      useLayoutEffect(() => external.publish(7), []);
      return createElement('output', null, resource.data);
    }
    await act(async () => root.render(createElement(View)));
    expect(host.textContent).toBe('7');
  });
});
