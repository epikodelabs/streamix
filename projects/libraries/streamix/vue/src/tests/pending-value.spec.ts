import { atom, flow } from '@epikodelabs/streamix';
import { createSSRApp, effectScope, h, nextTick } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { useIterable } from '../lib/useIterable';
import { read } from '../lib/atoms';
import { idescribe } from './env.spec';

describe('Vue pending values', () => {
  it('exposes undefined or the supplied fallback until the first emission', () => {
    const source = atom<string>();
    const scope = effectScope();
    scope.run(() => {
      const value = useIterable(source);
      const fallback = useIterable(source, 'loading');
      expect(value.value).toBeUndefined();
      expect(read(source)).toBeUndefined();
      expect(fallback.value).toBe('loading');
      source.next('ready');
      expect(value.value).toBe('ready');
      expect(fallback.value).toBe('ready');
    });
    scope.stop();
    source.dispose();
  });

  it('renders pending server markup without exposing the sentinel', async () => {
    const source = atom<string>();
    const app = createSSRApp({ setup() {
      const value = useIterable(source);
      return () => h('output', value.value ? value.value : 'pending');
    } });
    expect(await renderToString(app)).toBe('<output>pending</output>');
    source.dispose();
  });
});

idescribe('Vue pending hydration', () => {
  it('hydrates pending markup and updates when a delayed flow emits', async () => {
    let release!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>(resolve => release = resolve);
    const done = new Promise<void>(resolve => finish = resolve);
    const source = flow(async function* () { await ready; yield 'ready'; await done; });
    const view = { setup() {
      const value = useIterable(source);
      return () => h('output', value.value ? value.value : 'pending');
    } };
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Match the empty state rendered on the server before the first value.
    host.innerHTML = '<output>pending</output>';
    const output = host.firstChild;
    const app = createSSRApp(view);
    app.mount(host);
    expect(host.textContent).toBe('pending');
    expect(host.firstChild).toBe(output);
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    expect(host.textContent).toBe('ready');
    app.unmount();
    source.dispose();
    finish();
    host.remove();
  });
});
