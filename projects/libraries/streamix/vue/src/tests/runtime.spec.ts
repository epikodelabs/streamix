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
    expect(() => parseAtomSnapshot('{"version":2,"atoms":{}}'))
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
