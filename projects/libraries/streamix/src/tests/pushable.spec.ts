import {
  createAsyncPushable,
  DONE,
  NEXT,
} from '@epikodelabs/streamix';

describe('createAsyncPushable', () => {
  it('is an AsyncIterable (Symbol.asyncIterator returns self)', async () => {
    const pushable = createAsyncPushable<number>();

    expect(typeof (pushable as any)[Symbol.asyncIterator]).toBe('function');
    expect((pushable as any)[Symbol.asyncIterator]()).toBe(pushable as any);

    pushable.dispose();
    expect(await pushable.next()).toEqual(DONE);
  });

  it('delivers pushed values to the consumer and completes', async () => {
    const pushable = createAsyncPushable<number>();

    const firstPull = pushable.next();
    await pushable.push(1);
    expect(await firstPull).toEqual(NEXT(1));

    const secondPull = pushable.next();
    await pushable.push(2);
    expect(await secondPull).toEqual(NEXT(2));

    const donePull = pushable.next();
    pushable.dispose();
    expect(await donePull).toEqual(DONE);
    expect(pushable.disposed).toBeTrue();

    expect(await pushable.next()).toEqual(DONE);
  });

  it('buffers pushes before the first pull', async () => {
    const pushable = createAsyncPushable<number>();

    // push is sync, returns void
    const result = pushable.push(123);
    expect(result).toBeUndefined();

    expect(await pushable.next()).toEqual(NEXT(123));

    pushable.dispose();
    expect(await pushable.next()).toEqual(DONE);
  });

  it('rejects a pending pull when error() is called', async () => {
    const pushable = createAsyncPushable<number>();

    const pending = pushable.next();
    pushable.fail(new Error('boom'));

    await expectAsync(pending).toBeRejectedWithError('boom');
    expect(pushable.disposed).toBeTrue();
  });

  it('preserves buffered order', async () => {
    const pushable = createAsyncPushable<number>();

    pushable.push(1);
    pushable.push(2);
    pushable.push(3);

    expect(await pushable.next()).toEqual(NEXT(1));
    expect(await pushable.next()).toEqual(NEXT(2));
    expect(await pushable.next()).toEqual(NEXT(3));

    pushable.dispose();
  });

  it('supports synchronous __tryNext()', () => {
    const pushable = createAsyncPushable<number>();

    pushable.push(10);

    expect((pushable as any).__tryNext()).toEqual(NEXT(10));
    expect((pushable as any).__tryNext()).toBeNull();

    pushable.dispose();
  });

  it('tracks buffered values', () => {
    const pushable = createAsyncPushable<number>();

    expect((pushable as any).__hasBufferedValues()).toBeFalse();

    pushable.push(1);

    expect((pushable as any).__hasBufferedValues()).toBeTrue();

    (pushable as any).__tryNext();

    expect((pushable as any).__hasBufferedValues()).toBeFalse();

    pushable.dispose();
  });

  it('return() completes the iterator', async () => {
    const pushable = createAsyncPushable<number>();

    expect(await pushable.return?.()).toEqual(DONE);

    expect(pushable.disposed).toBeTrue();
    expect(await pushable.next()).toEqual(DONE);
  });

  it('return() drops buffered values', async () => {
    const pushable = createAsyncPushable<number>();

    pushable.push(1);
    pushable.push(2);

    expect(await pushable.next()).toEqual(NEXT(1));

    await pushable.return?.();

    expect(await pushable.next()).toEqual(DONE);
    expect((pushable as any).__tryNext()).toEqual(DONE);
  });

  it('throw() rejects and terminates', async () => {
    const pushable = createAsyncPushable<number>();

    await expectAsync(
      pushable.throw?.(new Error('boom'))
    ).toBeRejectedWithError('boom');

    expect(pushable.disposed).toBeTrue();
  });

  it('throw() drops buffered values', async () => {
    const pushable = createAsyncPushable<number>();

    pushable.push(1);
    pushable.push(2);

    expect(await pushable.next()).toEqual(NEXT(1));

    await pushable.throw?.(new Error('boom')).catch(() => {});

    expect(await pushable.next()).toEqual(DONE);
  });

  it('rejects pending next after throw()', async () => {
    const pushable = createAsyncPushable<number>();

    const pending = pushable.next();

    await pushable.throw?.(new Error('boom')).catch(() => {});

    await expectAsync(pending)
      .toBeRejectedWithError('boom');
  });

  it('ignores pushes after dispose', async () => {
    const pushable = createAsyncPushable<number>();

    pushable.dispose();

    pushable.push(1);

    expect(await pushable.next()).toEqual(DONE);
  });

  it('fail() behaves like error()', async () => {
    const pushable = createAsyncPushable<number>();

    const pending = pushable.next();

    pushable.fail(new Error('boom'));

    await expectAsync(pending)
      .toBeRejectedWithError('boom');
  });

  it('dispose() is idempotent', async () => {
    const pushable = createAsyncPushable<number>();

    pushable.dispose();
    pushable.dispose();
    pushable.dispose();

    expect(await pushable.next()).toEqual(DONE);
  });

  it('conflates buffered values', async () => {
    const pushable = createAsyncPushable<number>({
      conflate: true
    });

    pushable.push(1);
    pushable.push(2);
    pushable.push(3);

    expect(await pushable.next()).toEqual(NEXT(3));

    pushable.dispose();
  });

  it('delivers immediately to waiting consumer even with conflate', async () => {
    const pushable = createAsyncPushable<number>({
      conflate: true
    });

    const pending = pushable.next();

    pushable.push(42);

    expect(await pending).toEqual(NEXT(42));

    pushable.dispose();
  });

  it('next always returns DONE after completion', async () => {
    const pushable = createAsyncPushable<number>();

    pushable.dispose();

    expect(await pushable.next()).toEqual(DONE);
    expect(await pushable.next()).toEqual(DONE);
    expect(await pushable.next()).toEqual(DONE);
  });
});
