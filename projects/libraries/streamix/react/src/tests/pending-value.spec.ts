import { act, createElement } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { atom, flow } from '@epikodelabs/streamix';
import { read, useAtomValue, useStreamixSource } from '../lib/runtime';
import { idescribe } from './env.spec';

describe('React pending server values', () => {
  it('exposes undefined and renders the pending branch without subscribing', () => {
    const source = atom<string>();
    function View() {
      const value = useStreamixSource(source);
      expect(value).toBeUndefined();
      return createElement('output', null, value ? 'ready' : 'pending');
    }
    expect(read(source)).toBeUndefined();
    expect(renderToString(createElement(View))).toBe('<output>pending</output>');
    expect(source.subscriberCount).toBe(0);
    source.dispose();
  });
});

idescribe('React pending client values', () => {
  it('hydrates an uninitialized atom and updates on its first emission', async () => {
    const source = atom<string>();
    function View() {
      const value = useAtomValue(source);
      return createElement('output', null, value ? value : 'pending');
    }
    const host = document.createElement('div');
    host.innerHTML = renderToString(createElement(View));
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, createElement(View), { onRecoverableError: error => errors.push(error) });
    });
    expect(host.textContent).toBe('pending');
    act(() => source.next('ready'));
    expect(host.textContent).toBe('ready');
    expect(errors).toEqual([]);
    act(() => root.unmount());
    source.dispose();
  });

  it('renders a delayed flow as pending until its first emission', async () => {
    let release!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>(resolve => release = resolve);
    const done = new Promise<void>(resolve => finish = resolve);
    const source = flow(async function* () { await ready; yield 'ready'; await done; });
    const values: unknown[] = [];
    function View() {
      const value = useStreamixSource(source);
      values.push(value);
      return createElement('output', null, value ?? 'pending');
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(createElement(View)); });
    expect(host.textContent).toBe('pending');
    await act(async () => { release(); await ready; });
    expect(host.textContent).toBe('ready');
    expect(values[0]).toBeUndefined();
    expect(values.every(value => typeof value !== 'symbol')).toBeTrue();
    act(() => root.unmount());
    source.dispose();
    finish();
  });
});
