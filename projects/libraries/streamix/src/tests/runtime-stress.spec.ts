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

  it('never pulls a completed source again, even after repeated demand', async () => {
    const pulls = new RuntimeSourcePulls<number>();
    let calls = 0;
    const seen: IteratorResult<number>[] = [];
    pulls.attach(0, { next: async () => { calls++; return { done: true, value: undefined }; } });
    pulls.request(0, result => seen.push(result), () => undefined);
    await Promise.resolve();
    pulls.request(0, result => seen.push(result), () => undefined);
    expect(calls).toBe(1);
    expect(seen.length).toBe(1);
  });

  it('does not retry a failed source without explicitly replacing it', async () => {
    const pulls = new RuntimeSourcePulls<number>();
    let calls = 0;
    const errors: unknown[] = [];
    pulls.attach(0, { next: () => { calls++; throw new Error('failed'); } });
    pulls.request(0, () => undefined, error => errors.push(error));
    await Promise.resolve();
    await Promise.resolve();
    pulls.request(0, () => undefined, error => errors.push(error));
    expect(calls).toBe(1);
    expect(errors.length).toBe(1);
    pulls.attach(0, { next: async () => ({ done: false, value: 42 }) });
    const values: number[] = [];
    pulls.request(0, result => values.push(result.value), () => undefined);
    await Promise.resolve();
    expect(values).toEqual([42]);
  });

  it('routes delivery callback exceptions to the error sink without poisoning later pulls', async () => {
    const pulls = new RuntimeSourcePulls<number>();
    let count = 0;
    const failures: unknown[] = [];
    pulls.attach(0, { next: async () => ({ done: false, value: ++count }) });
    pulls.request(0, () => { throw new Error('consumer failed'); }, error => failures.push(error));
    await Promise.resolve();
    await Promise.resolve();
    expect(failures.length).toBe(1);
    const received: number[] = [];
    pulls.request(0, result => received.push(result.value), () => undefined);
    await Promise.resolve();
    expect(received).toEqual([2]);
  });

  it('contains errors thrown by the error sink on source failure', async () => {
    const pulls = new RuntimeSourcePulls<number>();
    let calls = 0;
    pulls.attach(0, { next: () => { calls++; throw new Error('source failed'); } });
    pulls.request(0, () => undefined, () => { throw new Error('error handler failed'); });
    await Promise.resolve();
    await Promise.resolve();
    pulls.request(0, () => undefined, () => undefined);
    expect(calls).toBe(1);
  });

});
