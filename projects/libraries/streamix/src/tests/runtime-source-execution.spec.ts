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
});
