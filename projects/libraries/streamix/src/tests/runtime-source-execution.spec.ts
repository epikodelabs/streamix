import { RuntimeEventDispatcher } from '../lib/runtime/events';
import { RuntimeSourceExecution } from '../lib/runtime/source-execution';

describe('runtime source execution', () => {
  const done = { done: true, value: undefined } as IteratorResult<number>;

  it('delivers runtime events in FIFO order across concurrent demand', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
    const first = execution.wait();
    const second = execution.wait();
    execution.publish(0, 10, 'next');
    execution.publish(1, 20, 'next');
    expect((await first).value).toBe(10);
    expect((await second).value).toBe(20);
    execution.close();
  });

  it('suppresses demand notification until the outer batch commits', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
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
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
    execution.publish(0, 1, 'next');
    execution.publish(1, 2, 'next');
    execution.dropSourceEvents(0);
    expect(execution.take()!.value).toBe(2);
    execution.close();
  });

  it('settles outstanding demand synchronously when closed', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
    const pending = execution.wait();
    execution.close();
    expect((await pending).done).toBe(true);
    execution.publish(0, 3, 'next');
    expect(execution.hasEvents).toBe(false);
  });
  it('settles demand registered after terminal completion without hanging', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
    execution.notify(true);
    expect((await execution.wait()).done).toBe(true);
    execution.publish(0, 42, 'next');
    expect(execution.hasEvents).toBe(false);
    execution.close();
  });

  it('drains queued values before returning terminal completion to late demand', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
    execution.publish(0, 11, 'next');
    execution.notify(true);
    expect(execution.take()!.value).toBe(11);
    expect((await execution.wait()).done).toBe(true);
    execution.close();
  });

  it('removes only events belonging to a detached source', () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
    execution.publish(0, 10, 'next');
    execution.publish(1, 20, 'next');
    execution.detach(0);
    expect(execution.take()!.value).toBe(20);
    expect(execution.hasEvents).toBe(false);
    execution.close();
  });

  it('does not resurrect queued reentrant events after detachment', () => {
    const events = new RuntimeEventDispatcher();
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
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
    execution.publish(0, 7, 'next');
    execution.publish(0, 8, 'next');
    execution.notify(true);
    expect((await execution.wait()).value).toBe(7);
    expect((await execution.wait()).value).toBe(8);
    expect((await execution.wait()).done).toBe(true);
    execution.close();
  });

  it('serves late demand from buffered events even before completion', async () => {
    const execution = new RuntimeSourceExecution<number, number>(new RuntimeEventDispatcher(), done);
    execution.publish(0, 17, 'next');
    expect((await execution.wait()).value).toBe(17);
    execution.close();
  });

});
