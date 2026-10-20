import { internalRuntime } from '../lib/runtime/runtime';
import { RuntimeEventBuffer } from '../lib/runtime/event-buffer';
import { RuntimeEventBus } from '../lib/runtime/events';
import { RuntimeSourceExecution } from '../lib/runtime/source-execution';
import { createAsyncCoordinator } from '../lib/utils/coordinator';

describe('runtime source execution', () => {
  it('releases consumed payloads and bounds storage while a backlog remains', () => {
    const buffer = new RuntimeEventBuffer<object>();
    // Inspect retention directly: FIFO assertions alone cannot detect retained payloads.
    const storage = buffer as unknown as { queued: unknown[]; queueHead: number };
    buffer.enqueue(0, { done: false, value: {} });
    buffer.enqueue(0, { done: false, value: {} });
    buffer.take();
    expect(storage.queued[0]).toBeUndefined();
    for (let i = 0; i < 4096; i++) {
      buffer.enqueue(0, { done: false, value: {} });
      buffer.take();
    }
    expect(buffer.hasEvents).toBe(true);
    expect(storage.queued.length).toBeLessThan(1026);
    buffer.close({ done: true, value: undefined });
  });

  it('releases resolved waiters while later demand remains outstanding', async () => {
    const buffer = new RuntimeEventBuffer<number>();
    const first = buffer.wait();
    const second = buffer.wait();
    buffer.enqueue(0, { done: false, value: 1 });
    buffer.flush(false, { done: true, value: undefined });
    const storage = buffer as unknown as { waiters: unknown[] };
    expect(storage.waiters[0]).toBeUndefined();
    expect((await first).value).toBe(1);
    buffer.close({ done: true, value: undefined });
    expect((await second).done).toBe(true);
  });
  const done = { done: true, value: undefined } as IteratorResult<number>;


  it('reopens transient completion when a dynamic source is attached', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    execution.notify(true);
    expect((await execution.wait()).done).toBe(true);
    execution.attach(1, { next: async () => ({ done: true, value: undefined }) });
    execution.publish(1, 42, 'next');
    expect((await execution.wait()).value).toBe(42);
    execution.notify(true);
    expect((await execution.wait()).done).toBe(true);
    execution.close();
  });

  it('preserves waiter FIFO priority when queued events are not yet flushed', async () => {
    const buffer = new RuntimeEventBuffer<number>();
    const first = buffer.wait();
    buffer.enqueue(0, { done: false, value: 10 });
    const second = buffer.wait();
    buffer.enqueue(0, { done: false, value: 20 });
    expect(buffer.take()).toBeUndefined();
    expect((await first).value).toBe(10);
    expect((await second).value).toBe(20);
    buffer.close(done);
  });

  it('delivers runtime events in FIFO order across concurrent demand', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    const first = execution.wait();
    const second = execution.wait();
    execution.publish(0, 10, 'next');
    execution.publish(1, 20, 'next');
    expect((await first).value).toBe(10);
    expect((await second).value).toBe(20);
    execution.close();
  });

  it('suppresses demand notification until the outer batch commits', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    let delivered = false;
    const pending = execution.wait().then(() => { delivered = true; });
    execution.batch(() => {
      execution.publish(0, 1, 'next');
      expect(delivered).toBe(false);
    }, () => false);
    await pending;
    expect(delivered).toBe(true);
    execution.close();
  });

  it('discards detached-source events without removing other source events', () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    execution.publish(0, 1, 'next');
    execution.publish(1, 2, 'next');
    execution.dropSourceEvents(0);
    expect(execution.take()!.value).toBe(2);
    execution.close();
  });

  it('settles outstanding demand synchronously when closed', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    const pending = execution.wait();
    execution.close();
    expect((await pending).done).toBe(true);
    execution.publish(0, 3, 'next');
    expect(execution.hasEvents).toBe(false);
  });
  it('settles demand registered after terminal completion without hanging', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    execution.notify(true);
    expect((await execution.wait()).done).toBe(true);
    execution.publish(0, 42, 'next');
    expect(execution.hasEvents).toBe(false);
    execution.close();
  });

  it('drains queued values before returning terminal completion to late demand', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    execution.publish(0, 11, 'next');
    execution.notify(true);
    expect(execution.take()!.value).toBe(11);
    expect((await execution.wait()).done).toBe(true);
    execution.close();
  });

  it('removes only events belonging to a detached source', () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    execution.publish(0, 10, 'next');
    execution.publish(1, 20, 'next');
    execution.detach(0);
    expect(execution.take()!.value).toBe(20);
    expect(execution.hasEvents).toBe(false);
    execution.close();
  });

  it('does not resurrect queued reentrant events after detachment', () => {
    const events = new RuntimeEventBus();
    const execution = new RuntimeSourceExecution<number, number>(events, done);
    // Register after execution's observer: publish reentrantly, then detach
    // while the dispatcher still holds the nested event in its queue.
    events.observe(event => {
      if (event.kind === 'next' && (event.value as any).payload === 1) {
        execution.publish(0, 2, 'next');
        execution.detach(0);
      }
    });
    execution.publish(0, 1, 'next');
    expect(execution.hasEvents).toBe(false);
    execution.close();
  });

  it('serves late demand from queued events before terminal completion', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    execution.publish(0, 7, 'next');
    execution.publish(0, 8, 'next');
    execution.notify(true);
    expect((await execution.wait()).value).toBe(7);
    expect((await execution.wait()).value).toBe(8);
    expect((await execution.wait()).done).toBe(true);
    execution.close();
  });

  it('serves late demand from buffered events even before completion', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    execution.publish(0, 17, 'next');
    expect((await execution.wait()).value).toBe(17);
    execution.close();
  });

  it('invalidates buffered events when an attached source slot is replaced', () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventBus(), done);
    const source: AsyncIterator<number> = { next: async () => ({ done: true, value: undefined as any }) };
    execution.attach(0, source);
    execution.publish(0, 1, 'next');
    execution.publish(1, 9, 'next');
    execution.attach(0, source);
    execution.publish(0, 2, 'next');
    expect(execution.take()!.value).toBe(9);
    expect(execution.take()!.value).toBe(2);
    expect(execution.hasEvents).toBe(false);
    execution.close();
  });

  it('rejects reentrant events from a previous source after slot replacement', () => {
    const events = new RuntimeEventBus();
    const execution = new RuntimeSourceExecution<number, number>(events, done);
    const source: AsyncIterator<number> = { next: async () => ({ done: true, value: undefined as any }) };
    execution.attach(0, source);
    events.observe(event => {
      if (event.kind === 'next' && (event.value as any).payload === 1) {
        execution.publish(0, 2, 'next');
        execution.attach(0, source);
        execution.publish(0, 3, 'next');
      }
    });
    execution.publish(0, 1, 'next');
    expect(execution.take()!.value).toBe(3);
    expect(execution.hasEvents).toBe(false);
    execution.close();
  });

});

describe('coordinator transport decoupling', () => {
  it('delivers source values without observing the shared runtime bus', async () => {
    // The runtime bus is the diagnostics gate: a live coordinator must never
    // mark it observed, or production apps using sources pay diagnostics
    // eventing with no observer. Assert the delta so pre-existing listeners
    // (e.g. an enabled inspector) do not affect the invariant.
    const observedBefore = internalRuntime.events.observed;
    const coordinator = createAsyncCoordinator<number>([{
      next: async () => ({ done: false, value: 7 }),
      return: async () => ({ done: true as const, value: undefined }),
    }]);
    try {
      const result = await coordinator.next();
      expect(result.value).toEqual({ type: 'value', value: 7, sourceIndex: 0 });
      expect(internalRuntime.events.observed).toBe(observedBefore);
    } finally {
      await coordinator.return?.();
    }
  });

  it('does not mark the shared runtime bus observed when created without sources', () => {
    const observedBefore = internalRuntime.events.observed;
    const coordinator = createAsyncCoordinator([]);
    expect(internalRuntime.events.observed).toBe(observedBefore);
    void coordinator.return?.();
  });
});
