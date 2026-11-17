import { effectScope } from 'vue';
import { atom } from '@epikodelabs/streamix';
import {
  atomRef,
  read,
  write,
} from '../lib/atoms';
import {
  hydrateAtomPayload,
  hydrateAtomSnapshot,
  hydrateAtomSnapshotFromDocument,
  parseAtomSnapshot,
  renderAtomSnapshotScript,
  serializeAtomSnapshot,
} from '../lib/ssr-snapshot';
import {
  recordStreamixDevtoolsEvent,
  useStreamixDevtoolsEvents,
} from '../lib/devtools';
import { useIterable } from '../lib/useIterable';

describe('Vue runtime escape hatches', () => {
  it('reads, writes, and forwards atom references without a Vue store copy', () => {
    const status = atom('Saved');

    expect(atomRef(status)).toBe(status);
    expect(read(status)).toBe('Saved');

    write(status, 'Updated');
    expect(read(status)).toBe('Updated');
  });

  it('serializes, validates, and hydrates a versioned SSR payload', () => {
    const serverTitle = atom('<Saved>');
    const clientTitle = atom('Client default');
    const serialized = serializeAtomSnapshot({ title: serverTitle });
    const payload = parseAtomSnapshot(serialized);

    expect(serialized).toContain('\\u003cSaved\\u003e');
    hydrateAtomPayload({ title: clientTitle }, payload);
    expect(clientTitle.value).toBe('<Saved>');
    expect(() => hydrateAtomPayload({ other: clientTitle }, payload))
      .toThrowError(/keys do not match/);
    expect(() => parseAtomSnapshot('{"version":3,"atoms":{}}'))
      .toThrowError(/Invalid Streamix atom snapshot payload/);
  });

  it('preserves undefined keys, rejects lossy snapshot values, and reads legacy payloads', () => {
    const explicitUndefined = atom<unknown>(undefined);
    const nested = atom({ list: [1, { ok: true }] });
    const payload = parseAtomSnapshot(serializeAtomSnapshot({ explicitUndefined, nested }));

    expect(payload.version).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(payload.atoms, 'explicitUndefined')).toBeTrue();
    expect(payload.atoms['explicitUndefined']).toBeUndefined();
    expect(payload.atoms['nested']).toEqual({ list: [1, { ok: true }] });

    const targetUndefined = atom<unknown>('initial');
    const targetNested = atom<unknown>(null);
    hydrateAtomPayload({ explicitUndefined: targetUndefined, nested: targetNested }, payload);
    expect(targetUndefined.value).toBeUndefined();
    expect(targetNested.value).toEqual({ list: [1, { ok: true }] });

    const legacy = parseAtomSnapshot('{"version":1,"atoms":{"title":"Legacy"}}');
    expect(legacy.version).toBe(1);
    const legacyTarget = atom('initial');
    hydrateAtomPayload({ title: legacyTarget }, legacy);
    expect(legacyTarget.value).toBe('Legacy');

    for (const value of [NaN, Infinity, -Infinity, new Date(0), new Map(), new Set([1]), 10n, Symbol('x'), () => 1]) {
      expect(() => serializeAtomSnapshot({ bad: atom<unknown>(value) })).toThrowError(/not serializable/);
    }
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => serializeAtomSnapshot({ cyclic: atom<unknown>(cyclic) })).toThrowError(/circular reference/);
    expect(() => serializeAtomSnapshot({ nestedUndefined: atom<unknown>({ skip: undefined }) })).toThrowError(/contains undefined/);
    expect(() => serializeAtomSnapshot({ nonFinite: atom<unknown>([1, NaN]) })).toThrowError(/not serializable/);
    expect(() => parseAtomSnapshot('{"version":2,"atoms":{"bad":{"t":"date","v":0}}}'))
      .toThrowError(/Invalid Streamix atom snapshot payload/);
  });

  it('hydrates a non-executable document payload and removes it afterward', () => {
    const serverTitle = atom('Saved');
    const clientTitle = atom('Client default');
    let removed = false;
    const element = {
      textContent: serializeAtomSnapshot({ title: serverTitle }),
      remove: () => { removed = true; },
    } as unknown as HTMLElement;
    const documentRoot = {
      getElementById: (id: string) => id === 'streamix-state' ? element : null,
    };

    hydrateAtomSnapshotFromDocument({ title: clientTitle }, 'streamix-state', documentRoot);

    expect(clientTitle.value).toBe('Saved');
    expect(removed).toBe(true);
    expect(() => renderAtomSnapshotScript({ title: serverTitle }, 'not valid'))
      .toThrowError(/id must contain/);

    hydrateAtomSnapshot({ title: clientTitle }, { title: 'Updated' });
    expect(clientTitle.value).toBe('Updated');
  });

  it('exposes queued DevTools events as a Vue ref', async () => {
    const observerScope = effectScope();
    const events = observerScope.run(() => useStreamixDevtoolsEvents())!;
    const sourceScope = effectScope();
    const count = atom(0);
    sourceScope.run(() => useIterable(count));

    recordStreamixDevtoolsEvent({ type: 'write', source: 'title' });
    count.next(1);
    await Promise.resolve();

    expect(events.value.some(event => event.type === 'write' && event.source === 'title')).toBe(true);
    expect(events.value.some(event => event.type === 'subscription' && event.source === 'Vue reactive source')).toBe(true);
    expect(events.value.some(event => event.type === 'write' && event.source === 'Vue reactive source')).toBe(true);
    sourceScope.stop();
    await Promise.resolve();
    expect(events.value.some(event => event.type === 'unsubscribe' && event.source === 'Vue reactive source')).toBe(true);
    observerScope.stop();
  });
});
