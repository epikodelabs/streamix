import {
  createAsyncPushable,
  DONE,
} from '@epikodelabs/streamix';

describe('createAsyncPushable', () => {
  it('is an AsyncIterable (Symbol.asyncIterator returns self)', async () => {
    const pushable = createAsyncPushable<number>();

    expect(typeof (pushable as any)[Symbol.asyncIterator]).toBe('function');
    expect((pushable as any)[Symbol.asyncIterator]()).toBe(pushable as any);

    pushable.complete();
    expect(await pushable.next()).toEqual(DONE);
  });

  it('delivers pushed values to the consumer and completes', async () => {
    const pushable = createAsyncPushable<number>();

    const firstPull = pushable.next();
    await pushable.push(1);
    expect(await firstPull).toEqual({ done: false, value: 1 });

    const secondPull = pushable.next();
    await pushable.push(2);
    expect(await secondPull).toEqual({ done: false, value: 2 });

    const donePull = pushable.next();
    pushable.complete();
    expect(await donePull).toEqual(DONE);
    expect(pushable.completed()).toBeTrue();

    expect(await pushable.next()).toEqual(DONE);
  });

  it('buffers pushes before the first pull', async () => {
    const pushable = createAsyncPushable<number>();

    // push is sync, returns void
    const result = pushable.push(123);
    expect(result).toBeUndefined();

    expect(await pushable.next()).toEqual({ done: false, value: 123 });

    pushable.complete();
    expect(await pushable.next()).toEqual(DONE);
  });

  it('rejects a pending pull when error() is called', async () => {
    const pushable = createAsyncPushable<number>();

    const pending = pushable.next();
    pushable.error(new Error('boom'));

    await expectAsync(pending).toBeRejectedWithError('boom');
    expect(pushable.completed()).toBeTrue();
  });

});
