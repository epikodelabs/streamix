import { createScheduler } from '@epikodelabs/streamix';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

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

  it('resolves task return values', async () => {
    const scheduler = createScheduler();

    const value = await scheduler.enqueue(() => 42);

    expect(value).toBe(42);
  });

  it('continues processing after an async task rejects', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    await Promise.allSettled([
      scheduler.enqueue(async () => {
        await Promise.resolve();
        throw new Error('boom');
      }),
      scheduler.enqueue(() => order.push('next')),
    ]);

    await scheduler.flush();
    expect(order).toEqual(['next']);
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

  it('resolves after queued work without blocking the queue', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];
    const deferred = createDeferred<string>();
    let resolved = false;

    const awaited = scheduler.await(deferred.promise).then((value) => {
      order.push(`awaited:${value}`);
      resolved = true;
    });

    scheduler.enqueue(() => order.push('task1'));
    scheduler.enqueue(() => order.push('task2'));

    await scheduler.flush();
    expect(order).toEqual(['task1', 'task2']);
    expect(resolved).toBeFalse();

    deferred.resolve('ok');
    await awaited;
    expect(order).toEqual(['task1', 'task2', 'awaited:ok']);
  });

  it('rejects with the original error without blocking the queue', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];
    const deferred = createDeferred<string>();
    const error = new Error('boom');
    let captured: unknown;

    const awaited = scheduler.await(deferred.promise).catch((err) => {
      captured = err;
    });

    scheduler.enqueue(() => order.push('task1'));
    await scheduler.flush();
    expect(order).toEqual(['task1']);

    deferred.reject(error);
    await awaited;
    expect(captured).toBe(error);
  });

  it('resolves after the timeout without blocking the queue', async () => {
    jasmine.clock().install();
    try {
      const scheduler = createScheduler();
      const order: string[] = [];
      let resolved = false;

      const delayed = scheduler.delay(50).then(() => {
        order.push('delay');
        resolved = true;
      });

      scheduler.enqueue(() => order.push('task1'));
      await scheduler.flush();
      expect(order).toEqual(['task1']);
      expect(resolved).toBeFalse();

      jasmine.clock().tick(50);
      await delayed;
      expect(order).toEqual(['task1', 'delay']);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('resolves flush immediately when already idle', async () => {
    const scheduler = createScheduler();
    let resolved = false;

    await scheduler.flush().then(() => {
      resolved = true;
    });

    expect(resolved).toBeTrue();
  });

  it('resolves multiple flush calls after queued work completes', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];

    scheduler.enqueue(() => order.push('task-1'));
    scheduler.enqueue(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      order.push('task-2');
    });

    const firstFlush = scheduler.flush().then(() => order.push('flush-1'));
    const secondFlush = scheduler.flush().then(() => order.push('flush-2'));

    await Promise.all([firstFlush, secondFlush]);

    expect(order).toEqual(['task-1', 'task-2', 'flush-1', 'flush-2']);
  });

  it('rejects the task promise when the task throws', async () => {
    const scheduler = createScheduler();
    const error = new Error('boom');
    let captured: unknown;

    await scheduler.enqueue(() => {
      throw error;
    }).catch((err) => {
      captured = err;
    });

    await scheduler.flush();
    expect(captured).toBe(error);
  });

  it('yields the queue while awaiting and resumes in FIFO order', async () => {
    const scheduler = createScheduler();
    const order: string[] = [];
    const deferred = createDeferred<string>();

    const running = scheduler.enqueue(async () => {
      order.push('start');
      const value = await scheduler.await(deferred.promise);
      order.push(`resume:${value}`);
    });

    scheduler.enqueue(() => order.push('after'));

    await scheduler.flush();
    expect(order).toEqual(['start', 'after']);

    deferred.resolve('ok');
    await running;
    await scheduler.flush();
    expect(order).toEqual(['start', 'after', 'resume:ok']);
  });

  it('allows the queue to run while delayed work is pending', async () => {
    jasmine.clock().install();
    try {
      const scheduler = createScheduler();
      const order: string[] = [];

      const delayed = scheduler.enqueue(async () => {
        order.push('start');
        await scheduler.delay(25);
        order.push('after-delay');
      });

      scheduler.enqueue(() => order.push('next'));

      await scheduler.flush();
      expect(order).toEqual(['start', 'next']);

      jasmine.clock().tick(25);
      await delayed;
      await scheduler.flush();
      expect(order).toEqual(['start', 'next', 'after-delay']);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
