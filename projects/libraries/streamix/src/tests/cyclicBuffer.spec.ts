import { cyclicBuffer } from '@epikodelabs/streamix';

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('cyclicBuffer', () => {
  it('pushes and iterates values in order', async () => {
    const buffer = cyclicBuffer<number>(4);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    const it = buffer[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe(1);
    expect((await it.next()).value).toBe(2);
    expect((await it.next()).value).toBe(3);
  });

  it('reports length', () => {
    const buffer = cyclicBuffer<number>(4);
    expect(buffer.length).toBe(0);
    buffer.push(1);
    expect(buffer.length).toBe(1);
    buffer.push(2);
    expect(buffer.length).toBe(2);
  });

  it('waits for values asynchronously', async () => {
    const buffer = cyclicBuffer<number>(4);
    const it = buffer[Symbol.asyncIterator]();

    const promise = it.next();
    buffer.push(42);

    expect((await promise).value).toBe(42);
  });

  it('returns done when closed and empty', async () => {
    const buffer = cyclicBuffer<number>(4);
    const it = buffer[Symbol.asyncIterator]();

    buffer.close();
    const result = await it.next();
    expect(result.done).toBe(true);
  });

  it('rejects pending waiters on close', async () => {
    const buffer = cyclicBuffer<number>(4);
    const it = buffer[Symbol.asyncIterator]();

    const promise = it.next();
    buffer.close();

    await expectAsync(promise).toBeRejectedWithError('Buffer closed');
  });

  it('tryPush returns true when value is accepted', () => {
    const buffer = cyclicBuffer<number>(4);
    expect(buffer.tryPush(1)).toBe(true);
    expect(buffer.tryPush(2)).toBe(true);
    expect(buffer.length).toBe(2);
  });

  it('tryPush returns false when discrete buffer is full', () => {
    const buffer = cyclicBuffer<number>(2, 'discrete');
    expect(buffer.tryPush(1)).toBe(true);
    expect(buffer.tryPush(2)).toBe(true);
    expect(buffer.tryPush(3)).toBe(false);
    expect(buffer.length).toBe(2);
  });

  it('tryPush overwrites in analog mode when full', async () => {
    const buffer = cyclicBuffer<number>(2, 'analog');
    expect(buffer.tryPush(1)).toBe(true);
    expect(buffer.tryPush(2)).toBe(true);
    expect(buffer.tryPush(3)).toBe(true);
    expect(buffer.length).toBe(2);

    const it = buffer[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe(3);
    expect((await it.next()).value).toBe(2);
  });

  it('async push waits for capacity in discrete mode', async () => {
    const buffer = cyclicBuffer<number>(2, 'discrete');
    buffer.push(1);
    buffer.push(2);

    let pushed = false;
    const pushPromise = buffer.push(3).then(() => { pushed = true; });

    await flushMicrotasks();
    expect(pushed).toBe(false);

    const it = buffer[Symbol.asyncIterator]();
    await it.next();
    await pushPromise;

    expect(pushed).toBe(true);
    expect((await it.next()).value).toBe(2);
    expect((await it.next()).value).toBe(3);
  });

  it('does not accept values after close', () => {
    const buffer = cyclicBuffer<number>(4);
    buffer.close();
    expect(buffer.tryPush(1)).toBe(false);
    expect(buffer.length).toBe(0);
  });

  it('allows multiple iterators to consume independently', async () => {
    const buffer = cyclicBuffer<number>(4);
    buffer.push(1);
    buffer.push(2);

    const it1 = buffer[Symbol.asyncIterator]();
    const it2 = buffer[Symbol.asyncIterator]();

    expect((await it1.next()).value).toBe(1);
    expect((await it2.next()).value).toBe(2);
  });

  it('iterator return resolves done', async () => {
    const buffer = cyclicBuffer<number>(4);
    const it = buffer[Symbol.asyncIterator]();

    const result = await it.return!();
    expect(result.done).toBe(true);
  });

  it('wraps around when capacity is exceeded and consumed', async () => {
    const buffer = cyclicBuffer<number>(2, 'discrete');
    const it = buffer[Symbol.asyncIterator]();

    buffer.push(1);
    buffer.push(2);
    expect((await it.next()).value).toBe(1);

    buffer.push(3);
    expect((await it.next()).value).toBe(2);
    expect((await it.next()).value).toBe(3);
  });
});
