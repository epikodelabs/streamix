import { RuntimeEventDispatcher } from '../lib/runtime/events';
import { RuntimeEventBuffer } from '../lib/runtime/event-buffer';
import { RuntimeSourcePulls } from '../lib/runtime/source-pulls';

describe('runtime execution stress and generation safety', () => {
  it('drains ten thousand reentrant events in FIFO order', () => {
    const events = new RuntimeEventDispatcher();
    const node = {};
    const seen: number[] = [];
    events.observe(event => {
      seen.push(event.sequence);
      if (event.sequence < 10000) events.publish({ node, generation: 1, kind: 'next' });
    });
    events.publish({ node, generation: 1, kind: 'next' });
    expect(seen.length).toBe(10000);
    expect(seen[9999]).toBe(10000);
  });

  it('delivers buffered values before terminal completion to all waiting consumers', async () => {
    const buffer = new RuntimeEventBuffer<string>();
    const terminal: IteratorResult<string> = { done: true, value: undefined };
    const pending = [buffer.wait(), buffer.wait(), buffer.wait()];
    buffer.enqueue(0, { done: false, value: 'a' });
    buffer.enqueue(0, { done: false, value: 'b' });
    buffer.flush(true, terminal);
    expect(await Promise.all(pending)).toEqual([
      { done: false, value: 'a' },
      { done: false, value: 'b' },
      terminal
    ]);
  });

  it('does not deliver obsolete source results after slot replacement', async () => {
    const pulls = new RuntimeSourcePulls<number>();
    let resolveOld!: (value: IteratorResult<number>) => void;
    const values: number[] = [];
    pulls.attach(0, { next: () => new Promise(resolve => { resolveOld = resolve; }) });
    pulls.request(0, result => values.push(result.value), () => undefined);
    pulls.detach(0);
    pulls.attach(0, { next: async () => ({ done: false, value: 2 }) });
    pulls.request(0, result => values.push(result.value), () => undefined);
    resolveOld({ done: false, value: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(values).toEqual([2]);
  });

  it('does not invoke source next concurrently for a single slot', async () => {
    const pulls = new RuntimeSourcePulls<number>();
    let resolveNext!: (value: IteratorResult<number>) => void;
    let calls = 0;
    pulls.attach(0, { next: () => { calls++; return new Promise(resolve => { resolveNext = resolve; }); } });
    pulls.request(0, () => undefined, () => undefined);
    pulls.request(0, () => undefined, () => undefined);
    expect(calls).toBe(1);
    resolveNext({ done: false, value: 1 });
    await Promise.resolve();
    expect(calls).toBe(1);
  });
});
