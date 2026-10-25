import { atom, derived, flow } from '../lib/atoms/atom';
import { scope } from '../lib/atoms/scope';
import { pipe } from '../lib/atoms/pipe';
import { map } from '../lib/operators/map';
import { internalRuntime } from '../lib/runtime/runtime';
import { __streamixDebug, __streamixSubscribe, enableStreamixIntrospection, streamixInspector, streamixPreview,
  type StreamixSourceMetadata } from '@epikodelabs/streamix/introspection';

const metadata = (name: string, kind: StreamixSourceMetadata['kind'] = 'atom'): StreamixSourceMetadata =>
  ({ name, kind, file: 'src/store.ts', line: 12, column: 3 });

describe('debug runtime introspection', () => {
  beforeAll(() => enableStreamixIntrospection());
  it('discovers uninstrumented flows and nested pipes without starting producers', () => {
    let starts = 0;
    const source = flow(async function* () { starts++; yield 1; });
    const first = pipe(source, map((value: number) => value + 1));
    const second = pipe(first, map((value: number) => value * 2));
    try {
      const rows = streamixInspector.inspect();
      const pipes = rows.filter(row => row.pipeline);
      expect(pipes.length).toBeGreaterThanOrEqual(2);
      expect(rows.filter(row => row.kind === 'flow').length).toBeGreaterThanOrEqual(3);
      expect(starts).toBe(0);
      // Compiler metadata refines the automatically discovered identity.
      __streamixDebug(first, metadata('discovered-pipe', 'flow'));
      const named = streamixInspector.inspect({ name: 'discovered-pipe' });
      expect(named.length).toBe(1);
      expect(named[0].pipeline).toBeTrue();
      expect(named[0].pipedSource).toBeFalse();
      expect(named[0].composition.length).toBeGreaterThan(0);
      expect(rows.find(row => row.id === named[0].composition[0])?.pipedSource).toBeTrue();
      first.dispose();
      const upstream = streamixInspector.inspect().find(row => row.id === named[0].composition[0]);
      expect(upstream?.pipedSource).toBeFalse();
    } finally { second.dispose(); first.dispose(); source.dispose(); }
    expect(streamixInspector.inspect({ name: 'discovered-pipe' }).length).toBe(0);
  });
  it('prunes dead weak entries incrementally while events are published', () => {
    const value = __streamixDebug(atom(1), metadata('pruned-entry'));
    const id = streamixInspector.inspect({ name: 'pruned-entry' })[0].id;
    const deref = WeakRef.prototype.deref;
    let visited = false;
    const read = spyOn(WeakRef.prototype, 'deref').and.callFake(function(this: WeakRef<object>) {
      const target = deref.call(this);
      if (target === value) { visited = true; return undefined; }
      return target;
    });
    const trigger = __streamixDebug(atom(0), metadata('pruning-trigger'));
    try {
      // The incremental sweep runs per appended event; drive it with real
      // runtime events for the trigger rather than re-debug refreshes, which
      // deliberately emit nothing.
      for (let i = 0; i < 2048 && !visited; i++) {
        internalRuntime.events.publish({ node: trigger, generation: 1, kind: 'next', value: i });
      }
      expect(visited).toBeTrue();
      read.and.callThrough();
      expect(streamixInspector.details(id)).toBeUndefined();
    } finally { read.and.callThrough(); value.dispose(); trigger.dispose(); }
  });
  it('preserves identity and distinguishes instances from one creation site', () => {
    const a = atom(1), b = atom(2);
    try {
      expect(__streamixDebug(a, metadata('same'))).toBe(a);
      __streamixDebug(b, metadata('same'));
      const rows = streamixInspector.inspect({ name: 'same' });
      expect(rows.length).toBe(2);
      expect(rows[0].id).not.toBe(rows[1].id);
      expect(rows[0].source.line).toBe(12);
    } finally { a.dispose(); b.dispose(); }
    expect(streamixInspector.inspect({ name: 'same' }).length).toBe(0);
  });
  it('announces a debugged object once; later calls refresh metadata silently', () => {
    const value = atom(1);
    try {
      __streamixDebug(value, metadata('rename-me'));
      const id = streamixInspector.inspect({ name: 'rename-me' })[0].id;
      // Compiler enrichment and pipeline wiring re-debug the same object;
      // those refreshes must not re-announce it in the trace.
      __streamixDebug(value, metadata('renamed'));
      const registers = streamixInspector.trace().filter(event => event.kind === 'register' && event.id === id);
      expect(registers.length).toBe(1);
      expect(registers[0].name).toBe('rename-me');
      expect(streamixInspector.inspect({ name: 'renamed' })[0].id).toBe(id);
    } finally { value.dispose(); }
  });
  it('never evaluates a derived formula or starts an idle producer', () => {
    let evaluations = 0, starts = 0;
    const value = __streamixDebug(derived(() => { evaluations++; return 7; }), metadata('lazy', 'derived'));
    const producer = __streamixDebug(flow(async function* () { starts++; yield 1; }), metadata('idle', 'flow'));
    try {
      expect(streamixInspector.inspect({ name: 'lazy' })[0].value).toBe('unevaluated');
      expect(streamixInspector.inspect({ name: 'idle' })[0].state).toBe('idle');
      expect(evaluations).toBe(0);
      expect(starts).toBe(0);
      expect(value.value).toBe(7);
      expect(streamixInspector.inspect({ name: 'lazy' })[0].value).toBe('7');
    } finally { value.dispose(); producer.dispose(); }
  });
  it('labels scope members and relates them to their owner without snapshot reads', () => {
    const model = __streamixDebug(scope({ count: 0, doubled: (self: any) => self.count * 2 }), {
      ...metadata('model', 'scope'), members: { count: { ...metadata('model.count'), line: 13 }, doubled: metadata('model.doubled', 'derived') },
    });
    try {
      const owner = streamixInspector.inspect({ kind: 'scope', name: 'model' })[0];
      const count = streamixInspector.inspect({ name: 'model.count' })[0];
      expect(count.owner).toBe(owner.id);
      expect(count.source.line).toBe(13);
      model.count = 3;
      expect(streamixInspector.details(count.id)?.value).toBe('3');
      expect(owner.members.some(member => member.name === 'doubled')).toBe(true);
    } finally { model.dispose(); }
    expect(streamixInspector.inspect({ name: 'model' }).length).toBe(0);
  });
  it('captures real pipeline values and bounded terminal history without retaining disposed objects', async () => {
    const op = __streamixDebug(map((v: number) => v * 2), metadata('double', 'operator'));
    const values = __streamixDebug(pipe([1, 2], op), metadata('numbers', 'flow'));
    const record = streamixInspector.inspect({ name: 'numbers' })[0];
    expect(record.composition.length).toBe(1);
    const seen: number[] = [];
    for await (const value of values) seen.push(value);
    expect(seen).toEqual([2, 4]);
    expect(streamixInspector.details(record.id)).toBeUndefined();
    expect(streamixInspector.trace().some(e => e.id === record.id && e.kind === 'complete')).toBe(true);
    const counter = __streamixDebug(atom(0), metadata('counter'));
    try { for (let i = 1; i <= 1100; i++) counter.set(i); }
    finally { counter.dispose(); }
    expect(streamixInspector.trace().length).toBe(1000);
  });
  it('preserves subscription identity and receiver and links component fields to their target', async () => {
    const source = __streamixDebug(atom(1), metadata('App.value'));
    const original = source.subscribe;
    let actual: ReturnType<typeof source.subscribe> | undefined;
    let lookups = 0;
    Object.defineProperty(source, 'subscribe', { configurable: true, get() {
      lookups++;
      return function(this: typeof source, ...args: Parameters<typeof source.subscribe>) {
        expect(this).toBe(source);
        actual = original.apply(this, args);
        return actual;
      };
    } });
    const control = source.subscribe(() => {});
    const baselineLookups = lookups;
    await control();
    lookups = 0;
    const values: number[] = [];
    const subscribe = __streamixSubscribe(source, { ...metadata('App.viewport', 'subscription'), ownerClass: 'App', field: 'viewport', enclosing: 'App.start' });
    const stop = subscribe(value => { values.push(value); });
    try {
      expect(lookups).toBe(baselineLookups);
      expect(stop).toBe(actual);
      const handle = streamixInspector.inspect({ name: 'App.viewport' })[0];
      const target = streamixInspector.inspect({ name: 'App.value' })[0];
      expect(handle.kind).toBe('subscription');
      expect(handle.source.ownerClass).toBe('App');
      expect(handle.target).toBe(target.id);
      expect(target.consumers).toContain(handle.id);
      source.set(2);
      expect(values).toEqual([1, 2]);
      await stop();
      expect(streamixInspector.details(handle.id)).toBeUndefined();
      expect(streamixInspector.details(target.id)?.consumers).not.toContain(handle.id);
    } finally { await stop(); source.dispose(); }
  });
  it('summarizes circular payloads without invoking getters and isolates observers', () => {
    let getterCalls = 0;
    const payload: any = { get value() { getterCalls++; return 1; } }; payload.self = payload;
    expect(streamixPreview(payload)).toContain('[circular]');
    expect(getterCalls).toBe(0);
    const stop = streamixInspector.observe(() => { throw new Error('observer'); });
    const node = __streamixDebug(atom(1), metadata('observed'));
    try { expect(() => node.set(2)).not.toThrow(); }
    finally { stop(); node.dispose(); }
  });
  it('counts callback-free flow subscriptions and keeps the producer alive until the last handle closes', async () => {
    const source = atom(1);
    const node = __streamixDebug(flow(source), metadata('callback-free-flow', 'flow'));
    const id = streamixInspector.inspect({ name: 'callback-free-flow' })[0].id;
    const keepAlive = node.subscribe();
    const callback = node.subscribe(() => {});
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(node.subscriberCount).toBe(2);
      expect(streamixInspector.details(id)?.subscribers).toBe(2);
      expect(node.disposed).toBeFalse();
      await callback();
      expect(node.subscriberCount).toBe(1);
      expect(streamixInspector.details(id)?.subscribers).toBe(1);
      expect(node.disposed).toBeFalse();
      await keepAlive();
      expect(node.subscriberCount).toBe(0);
      expect(node.disposed).toBeTrue();
      expect(streamixInspector.details(id)).toBeUndefined();
    } finally { await keepAlive(); await callback(); node.dispose(); source.dispose(); }
  });
  it('keeps the flow subscriber count at zero after explicit disposal and repeated unsubscribe', async () => {
    const source = atom(1);
    const node = flow(source);
    const first = node.subscribe(), second = node.subscribe();
    try {
      node.dispose();
      await first(); await second(); await first();
      expect(node.subscriberCount).toBe(0);
    } finally { node.dispose(); source.dispose(); }
  });
  it('reports recoverable failures and releases their live records on unsubscribe', async () => {
    const node = __streamixDebug(flow(async function* () { yield 1; throw new Error('offline'); }), metadata('failed', 'flow'));
    node.onError(() => {});
    const stop = node.subscribe(() => {});
    try {
      for (let i = 0; i < 20 && streamixInspector.inspect({ name: 'failed' })[0]?.state !== 'error'; i++)
        await new Promise(resolve => setTimeout(resolve, 0));
      const record = streamixInspector.inspect({ name: 'failed' })[0];
      expect(record.state).toBe('error');
      expect(record.error).toBe('offline');
      expect(record.value).toBe('1');
      expect(streamixInspector.trace().some(event => event.id === record.id && event.error === 'offline')).toBe(true);
    } finally { await stop(); }
    expect(streamixInspector.inspect({ name: 'failed' }).length).toBe(0);
  });
});
