import { act, createElement, Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { atom, createSubscription, flow, NO_INITIAL_VALUE, type Writable } from '@epikodelabs/streamix';
import { hydrateAtomPayload, parseAtomSnapshot, read, serializeAtomSnapshot, useStreamixSource, useWritable } from '../lib/runtime';
import { idescribe } from './env.spec';

/** Minimal error boundary: captures the delivered failure and renders a fallback. */
class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: undefined as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error !== undefined) {
      return createElement('output', { id: 'fallback' }, `failed: ${(this.state.error as Error).message}`);
    }
    return this.props.children;
  }
}

idescribe('React error delivery', () => {
  let host: HTMLElement;
  let root: Root | undefined;
  let caught: unknown[];

  beforeEach(() => { caught = []; });
  afterEach(() => { teardown(); });

  function render(view: ReactNode): void {
    if (!host) host = document.createElement('div');
    if (!root) root = createRoot(host, { onCaughtError: error => { caught.push(error); } });
    act(() => { root!.render(view); });
  }

  function teardown(): void {
    if (root) act(() => { root!.unmount(); });
    root = undefined;
    host?.remove();
    host = undefined as unknown as HTMLElement;
  }

  it('delivers a source failure through the nearest error boundary', () => {
    const source = atom('ok');
    function View() {
      const value = useStreamixSource(source);
      return createElement('output', { id: 'view' }, value);
    }
    render(createElement(Boundary, null, createElement(View)));
    expect(host.textContent).toBe('ok');

    const failure = new Error('boom');
    act(() => { source.fail(failure); });
    expect(caught).toEqual([failure]);
    expect(host.querySelector('#fallback')?.textContent).toBe('failed: boom');
    // The stale successful value is no longer displayed.
    expect(host.querySelector('#view')).toBeNull();
    teardown();
    source.dispose();
  });

  it('reports a rejected subscription teardown when the view unmounts', async () => {
    const failure = new Error('unsubscribe failed');
    const report = spyOn(console, 'error');
    const source = atom('ok');
    const subscribe = source.subscribe.bind(source);
    spyOn(source, 'subscribe').and.callFake(callback => {
      const stop = subscribe(callback);
      return createSubscription(async () => { await stop(); throw failure; });
    });
    function View() {
      return createElement('output', null, useStreamixSource(source));
    }
    render(createElement(View));
    teardown();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledWith(jasmine.stringMatching(/teardown failed/), failure);
    source.dispose();
  });

  it('renders the recovered value after a boundary retry following a successful emission', () => {
    const source = atom('ok');
    let renderCount = 0;
    function View() {
      renderCount++;
      const value = useStreamixSource(source);
      return createElement('output', { id: 'view' }, value);
    }
    render(createElement(Boundary, null, createElement(View)));
    const failure = new Error('boom');
    act(() => { source.fail(failure); });
    expect(caught).toEqual([failure]);
    expect(host.querySelector('#fallback')).not.toBeNull();

    // A later successful emission clears the failure state; the boundary's
    // retry remount reads the recovered value.
    act(() => { source.next('fixed'); });
    render(createElement(Boundary, { key: 'retry', children: createElement(View) }));
    expect(host.querySelector('#view')?.textContent).toBe('fixed');
    expect(caught).toEqual([failure]);
    expect(renderCount).toBeGreaterThan(0);
    teardown();
    source.dispose();
  });

  it('keeps a completed flow readable without delivering a failure', async () => {
    let release!: () => void;
    const finished = new Promise<void>(resolve => release = resolve);
    const source = flow(async function* () { yield 'only'; await finished; });
    function View() {
      const value = useStreamixSource(source);
      return createElement('output', { id: 'view' }, value ?? 'empty');
    }
    render(createElement(Boundary, null, createElement(View)));
    // Flows activate on subscribe: the first emission lands asynchronously.
    await act(async () => {});
    expect(host.querySelector('#view')?.textContent).toBe('only');
    expect(caught).toEqual([]);
    // Let the flow complete and dispose its backing atom, then force another
    // render: the last emission stays, and no failure is delivered.
    await act(async () => { release(); await finished; });
    render(createElement(Boundary, null, createElement(View)));
    expect(host.querySelector('#fallback')).toBeNull();
    expect(host.querySelector('#view')?.textContent).toBe('only');
    teardown();
    source.dispose();
  });

  it('throws failed reads from read() while pending reads stay undefined', () => {
    const pending = atom<string>();
    expect(read(pending)).toBeUndefined();
    const source = atom('value');
    source.fail(new Error('boom'));
    expect(() => read(source)).toThrowError('boom');
    // Writing recovers: the error state clears.
    source.next('recovered');
    expect(read(source)).toBe('recovered');
    pending.dispose();
    source.dispose();
  });

  it('gives functional useWritable updates the last safe value and recovers the atom', () => {
    const source: Writable<number> = atom(7);
    let update!: (next: number | ((previous: number) => number)) => void;
    function View() {
      [, update] = useWritable(source);
      return null;
    }
    // The failure reaches the boundary (delivery contract); the captured
    // setter outlives the unmounted view.
    render(createElement(Boundary, null, createElement(View)));
    const failure = new Error('boom');
    act(() => { source.fail(failure); });
    expect(caught).toEqual([failure]);
    expect(host.querySelector('#fallback')).not.toBeNull();
    let received: unknown;
    act(() => { update(previous => { received = previous; return previous + 1; }); });
    // The updater saw the last safe value, not a thrown read or a sentinel.
    expect(received).toBe(7);
    expect(source.value).toBe(8);
    expect(source.error).toBeUndefined();
    teardown();
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
