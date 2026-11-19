import {
  createSSRApp,
  effectScope,
  h,
} from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
  recordStreamixDevtoolsEvent,
  streamixDevtoolsSnapshot,
} from '@epikodelabs/streamix';
import {
  StreamixDevtools,
  createStreamixDevtoolsEventsBridge,
  useStreamixDevtoolsEvents,
  ɵrecordStreamixDevtoolsWrite,
  ɵsetStreamixDevtoolsEnabled,
} from '../lib/devtools';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Vue DevTools lifecycle', () => {
  afterEach(() => {
    ɵsetStreamixDevtoolsEnabled(true);
  });

  it('requires an effect scope for the composable and offers a manual bridge', async () => {
    expect(() => useStreamixDevtoolsEvents()).toThrowError(/active effectScope/);

    const bridge = createStreamixDevtoolsEventsBridge();
    const source = `manual-${Date.now()}`;
    recordStreamixDevtoolsEvent({ type: 'write', source });
    await flushMicrotasks();

    expect(bridge.events.value.some(event => event.source === source)).toBeTrue();

    bridge.dispose();
    const lengthAtDispose = bridge.events.value.length;
    recordStreamixDevtoolsEvent({ type: 'write', source: `${source}-after` });
    await flushMicrotasks();

    // The disposal removed the listener: the ref no longer follows the store.
    expect(bridge.events.value.length).toBe(lengthAtDispose);
  });

  it('subscribes inside an active effect scope', async () => {
    const scope = effectScope();
    const events = scope.run(() => useStreamixDevtoolsEvents())!;
    const source = `scoped-${Date.now()}`;

    recordStreamixDevtoolsEvent({ type: 'write', source });
    await flushMicrotasks();
    expect(events.value.some(event => event.source === source)).toBeTrue();

    scope.stop();
  });

  it('renders nothing in production builds', async () => {
    ɵsetStreamixDevtoolsEnabled(false);
    const app = createSSRApp({ render: () => h(StreamixDevtools) });

    const html = await renderToString(app);

    expect(html).not.toContain('data-streamix-devtools');
  });

  it('renders a stable empty panel during server rendering', async () => {
    recordStreamixDevtoolsEvent({ type: 'write', source: 'server-request-trace' });
    const app = createSSRApp({ render: () => h(StreamixDevtools) });

    const html = await renderToString(app);

    expect(html).toContain('data-streamix-devtools');
    // Server output must not read the process-wide snapshot: that would mix
    // traces between requests.
    expect(html).not.toContain('server-request-trace');
  });

  it('does not serialize a write preview while recording is disabled', () => {
    let reads = 0;
    ɵrecordStreamixDevtoolsWrite('disabled', () => {
      reads += 1;
      return { large: 'value' };
    }, false);
    expect(reads).toBe(0);

    const source = `enabled-${Date.now()}`;
    ɵrecordStreamixDevtoolsWrite(source, () => ({ large: 'value' }), true);
    const event = streamixDevtoolsSnapshot().find(item => item.source === source);
    expect(event?.value).toContain('large');
  });
});
