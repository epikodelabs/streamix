import { createScheduler } from '@epikodelabs/streamix';

describe('scheduler', () => {
  it('executes tasks in FIFO order for sync and async work', async () => {
    const scheduler = createScheduler();
    const order: number[] = [];

    scheduler.enqueue(() => order.push(1));
    scheduler.enqueue(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      order.push(2);
    });
    scheduler.enqueue(() => order.push(3));

    await scheduler.flush();
    expect(order).toEqual([1, 2, 3]);
  });

  it('continues processing after a task rejects', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    await Promise.allSettled([
      scheduler.enqueue(() => {
        throw new Error('boom');
      }),
      scheduler.enqueue(() => order.push('next')),
    ]);

    await scheduler.flush();
    expect(order).toEqual(['next']);
  });

  it('waits for microtask-enqueued work before flush resolves', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    scheduler.enqueue(() => {
      order.push('first');
      Promise.resolve().then(() => {
        scheduler.enqueue(() => order.push('second'));
      });
    });

    await scheduler.flush();
    expect(order).toEqual(['first', 'second']);
  });

  it('supports generators as tasks', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    function* task() {
      order.push('a');
      yield 1;
      order.push('b');
      yield 2;
      return 'done';
    }

    const result = await scheduler.enqueue(() => task());
    await scheduler.flush();

    expect(result).toBe('done');
    expect(order).toEqual(['a', 'b']);
  });

  it('supports async generators as tasks', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    async function* task() {
      order.push('a');
      yield 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      order.push('b');
      yield 2;
      return 'done';
    }

    const result = await scheduler.enqueue(() => task());
    await scheduler.flush();

    expect(result).toBe('done');
    expect(order).toEqual(['a', 'b']);
  });

  it('schedules delayed callbacks without blocking the queue', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    const delayed = scheduler.delay(20, () => {
      order.push('delayed');
    });

    await scheduler.enqueue(() => order.push('now'));
    await delayed;
    await scheduler.flush();

    expect(order).toEqual(['now', 'delayed']);
  });

  it('resolves multiple flush callers together', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    scheduler.enqueue(async () => {
      order.push('task');
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    });

    const a = scheduler.flush().then(() => order.push('flush-a'));
    const b = scheduler.flush().then(() => order.push('flush-b'));

    await Promise.all([a, b]);
    expect(order).toEqual(['task', 'flush-a', 'flush-b']);
  });

  it('resolves delay without a callback while queue continues', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    const delayed = scheduler.delay(10);
    await scheduler.enqueue(() => order.push('now'));
    await delayed;
    await scheduler.flush();

    expect(order).toEqual(['now']);
  });

  it('allows generator tasks to yield while preserving FIFO order', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    function* task() {
      order.push('g1');
      Promise.resolve().then(() => {
        scheduler.enqueue(() => order.push('late'));
      });
      yield 1;
      order.push('g2');
      yield 2;
      return 'done';
    }

    await scheduler.enqueue(() => task());
    await scheduler.flush();

    expect(order).toEqual(['g1', 'g2', 'late']);
  });

  it('preserves order when tasks enqueue more work', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    scheduler.enqueue(() => {
      order.push('a');
      scheduler.enqueue(() => order.push('b'));
    });

    scheduler.enqueue(() => order.push('c'));

    await scheduler.flush();
    expect(order).toEqual(['a', 'c', 'b']);
  });
});
