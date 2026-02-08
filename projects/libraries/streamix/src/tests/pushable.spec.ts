import {
  createAsyncPushable,
  DONE,
  getIteratorMeta,
  getValueMeta,
  unwrapPrimitive,
  type IteratorMetaKind,
} from '@epikodelabs/streamix';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

  it('buffers pushes before the first pull and applies backpressure', async () => {
    const pushable = createAsyncPushable<number>();

    const backpressure = pushable.push(123);
    expect(backpressure).toEqual(jasmine.any(Promise));

    let resolved = false;
    (backpressure as Promise<void>).then(() => {
      resolved = true;
    });

    await flush();
    expect(resolved).toBeFalse();

    expect(await pushable.next()).toEqual({ done: false, value: 123 });
    await backpressure;

    await flush();
    expect(resolved).toBeTrue();

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

  it('tags iterator/value metadata when push() is provided meta/tag', async () => {
    const pushable = createAsyncPushable<number>();

    const meta = { valueId: 'v1', operatorIndex: 7, operatorName: 'testOp' };
    const tag: { kind?: IteratorMetaKind; inputValueIds?: string[] } = {
      kind: 'transform',
      inputValueIds: ['a', 'b'],
    };

    const pull = pushable.next();
    await pushable.push(5, meta, tag);

    const result = await pull;
    expect(result.done).toBeFalse();

    const pushedValue = (result as any).value;
    expect(unwrapPrimitive(pushedValue)).toBe(5);

    expect(getIteratorMeta(pushable as any)).toEqual({
      valueId: 'v1',
      operatorIndex: 7,
      operatorName: 'testOp',
      kind: 'transform',
      inputValueIds: ['a', 'b'],
    });

    expect(getValueMeta(pushedValue)).toEqual({
      valueId: 'v1',
      operatorIndex: 7,
      operatorName: 'testOp',
      kind: 'transform',
      inputValueIds: ['a', 'b'],
    });

    pushable.complete();
    expect(await pushable.next()).toEqual(DONE);
  });
});
