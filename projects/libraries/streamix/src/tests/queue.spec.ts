import { createQueue } from '@epikode/streamix';

describe('createQueue', () => {
  it('executes operations sequentially', async () => {
    const q = createQueue();
    const order: number[] = [];

    const op = (id: number, delay: number) => q.enqueue(async () => {
      await new Promise(res => setTimeout(res, delay));
      order.push(id);
    });

    await Promise.all([op(1, 30), op(2, 10), op(3, 0)]);

    expect(order).toEqual([1, 2, 3]);
    expect(q.isEmpty).toBeTrue();
    expect(q.pending).toBe(0);
  });

  it('does not lock on rejected operations', async () => {
    const q = createQueue();
    const results: string[] = [];

    await Promise.allSettled([
      q.enqueue(async () => { throw new Error('boom'); }),
      q.enqueue(async () => { results.push('next'); })
    ]);

    expect(results).toEqual(['next']);
    expect(q.isEmpty).toBeTrue();
  });
});

