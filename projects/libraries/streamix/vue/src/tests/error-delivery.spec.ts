import { atom, flow, NO_INITIAL_VALUE } from '@epikodelabs/streamix';
import { createSSRApp, h, nextTick } from 'vue';
import { useIterable } from '../lib/useIterable';
import { read } from '../lib/atoms';
import { hydrateAtomPayload, parseAtomSnapshot, serializeAtomSnapshot } from '../lib/ssr-snapshot';
import { idescribe } from './env.spec';

function createTrackedApp(setup: () => () => unknown) {
  const handled: unknown[] = [];
  const app = createSSRApp({ setup });
  app.config.errorHandler = (error: unknown) => { handled.push(error); };
  const host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  return { app, host, handled };
}

idescribe('Vue error delivery', () => {
  it('delivers a source failure through app.config.errorHandler and recovers in place', async () => {
    const source = atom('ok');
    const { app, host, handled } = createTrackedApp(() => {
      const value = useIterable(source);
      return () => h('output', (value.value ?? 'pending') as never);
    });
    expect(host.textContent).toBe('ok');

    source.fail(new Error('boom'));
    await nextTick();
    // The failure reached the framework error handler instead of the stale
    // value being served.
    expect(handled.length).toBe(1);
    expect((handled[0] as Error).message).toBe('boom');
    // Vue keeps the component mounted: the next successful emission recovers
    // the same view in place.
    source.next('fixed');
    await nextTick();
    expect(host.textContent).toBe('fixed');
    expect(handled.length).toBe(1);
    app.unmount();
    source.dispose();
    host.remove();
  });

  it('keeps a completed flow readable without delivering a failure', async () => {
    let release!: () => void;
    const finished = new Promise<void>(resolve => release = resolve);
    const source = flow(async function* () { yield 'only'; await finished; });
    const { app, host, handled } = createTrackedApp(() => {
      const value = useIterable(source);
      return () => h('output', (value.value ?? 'empty') as never);
    });
    // Flows activate on subscribe: the first emission lands asynchronously.
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    expect(host.textContent).toBe('only');
    // Let the flow complete and dispose its backing atom.
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    expect(host.textContent).toBe('only');
    expect(handled).toEqual([]);
    app.unmount();
    source.dispose();
    host.remove();
  });

  it('throws failed reads from read() while pending reads stay undefined', () => {
    const pending = atom<string>();
    expect(read(pending)).toBeUndefined();
    const source = atom('value');
    source.fail(new Error('boom'));
    expect(() => read(source)).toThrowError('boom');
    pending.dispose();
    source.dispose();
  });

  it('round-trips final emissions from completed flows, including undefined', async () => {
    const status = flow(async function* () { yield 'loading'; yield 'done'; });
    const explicit = flow<undefined>(async function* () { yield undefined; });
    const empty = flow<never>(async function* () {});
    const collect = async (source: AsyncIterable<unknown>) => {
      for await (const _ of source) { /* Activate the flow and wait for completion. */ }
    };
    const targetStatus = atom<string>();
    const targetExplicit = atom<undefined>();
    try {
      await Promise.all([collect(status), collect(explicit), collect(empty)]);
      // Natural completion preserves live reads in the current core. Also
      // verify the disposed-source path used by server-owned teardown.
      expect(parseAtomSnapshot(serializeAtomSnapshot({ status, explicit, empty })).atoms)
        .toEqual({ status: 'done', explicit: undefined });
      status.dispose();
      explicit.dispose();
      empty.dispose();
      expect([status.disposed, explicit.disposed, empty.disposed]).toEqual([true, true, true]);

      const payload = parseAtomSnapshot(serializeAtomSnapshot({ status, explicit, empty }));
      expect(Object.keys(payload.atoms)).toEqual(['status', 'explicit']);
      hydrateAtomPayload({ status: targetStatus, explicit: targetExplicit }, payload);
      expect(targetStatus.value).toBe('done');
      expect(targetExplicit.value).toBeUndefined();
    } finally {
      status.dispose();
      explicit.dispose();
      empty.dispose();
      targetStatus.dispose();
      targetExplicit.dispose();
    }
  });

  it('omits pending and failed sources from SSR snapshots and hydrates the rest', () => {
    const good = atom('kept');
    const pending = atom<string>();
    const failed = atom('stale');
    failed.fail(new Error('boom'));
    const payload = parseAtomSnapshot(serializeAtomSnapshot({ good, pending, failed }));
    expect(Object.keys(payload.atoms)).toEqual(['good']);

    const clientGood = atom('server default');
    const clientPending = atom<string>();
    hydrateAtomPayload({ good: clientGood, pending: clientPending }, payload);
    expect(clientGood.value).toBe('kept');
    // The omitted target simply stays uninitialized; it is not partially hydrated.
    expect((clientPending as { value: unknown }).value).toBe(NO_INITIAL_VALUE);
    good.dispose();
    pending.dispose();
    failed.dispose();
    clientGood.dispose();
    clientPending.dispose();
  });
});
