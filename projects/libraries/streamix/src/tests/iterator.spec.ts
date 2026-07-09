import {
  createAsyncIterator,
  createSubscription,
  DONE,
  NEXT
} from '@epikodelabs/streamix';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

type TestObserver<T> = {
  next: (value: T) => unknown;
  fail: (err: unknown) => unknown;
  complete: () => unknown;
  readonly disposed: boolean;
};

describe('createAsyncIterator', () => {
  it('delivers values via for-await-of and supports return', async () => {
    const registered: TestObserver<number>[] = [];
    const register = (receiver: TestObserver<number>) => {
      registered.push(receiver);
      return createSubscription();
    };

    const iterator = createAsyncIterator<number>({ register })();
    const firstPull = iterator.next();

    const firstReceiver = registered[0];
    firstReceiver.next(10);
    expect(await firstPull).toEqual(NEXT(10));

    const donePull = iterator.next();
    firstReceiver.complete();
    expect(await donePull).toEqual(DONE);

    const returned = await iterator.return?.();
    expect(returned).toEqual(DONE);
  });

  it('rejects throw() when iterator is active', async () => {
    const registerCapture = createRegisterCapture();
    const iterator = createAsyncIterator<number>({ register: registerCapture.fn })();

    const pending = iterator.next();
    registerCapture.receiver!.next(1);
    await pending;

    const thrown = iterator.throw?.(new Error('fail'));
    await expectAsync(thrown).toBeRejectedWithError('fail');
  });

  it('exposes buffered helpers', async () => {
    const registerCapture = createRegisterCapture();
    const iterator = createAsyncIterator<number>({ register: registerCapture.fn })();

    iterator.next();
    registerCapture.receiver!.next(1);
    await flush();

    registerCapture.receiver!.next(2);
    const buffered = (iterator as any).__tryNext?.();
    expect(buffered).toEqual(NEXT(2));
    expect((iterator as any).__hasBufferedValues?.()).toBeFalse();
  });

  it("registers exactly once", () => {
    const register = jasmine.createSpy().and.returnValue(createSubscription());

    const iterator = createAsyncIterator<number>({ register })();

    iterator.next();
    iterator.next();
    iterator.next();

    expect(register).toHaveBeenCalledTimes(1);
  });

  it("creates independent iterators", async () => {
    const observers: TestObserver<number>[] = [];

    const factory = createAsyncIterator<number>({
      register(observer) {
        observers.push(observer);
        return createSubscription();
      }
    });

    const a = factory();
    const b = factory();

    const pa = a.next();
    const pb = b.next();

    observers[0].next(1);
    observers[1].next(2);

    expect(await pa).toEqual(NEXT(1));
    expect(await pb).toEqual(NEXT(2));
  });

  it("rejects next when observer fails", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn
    })();

    const promise = iterator.next();

    capture.receiver!.fail(new Error("boom"));

    await expectAsync(promise)
      .toBeRejectedWithError("boom");
  });

  it("stays completed after complete", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn
    })();

    iterator.next();

    capture.receiver!.complete();

    expect(await iterator.next()).toEqual(DONE);
    expect(await iterator.next()).toEqual(DONE);
  });

  it("calls unsubscribe on return", async () => {
    const unsubscribe = jasmine.createSpy();

    const iterator = createAsyncIterator<number>({
      register() {
        return createSubscription(unsubscribe);
      }
    })();

    await iterator.return?.().catch(() => {});

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("calls unsubscribe on throw", async () => {
    const unsubscribe = jasmine.createSpy();

    const iterator = createAsyncIterator<number>({
      register() {
        return createSubscription(unsubscribe);
      }
    })();

    await iterator.throw?.(new Error("x")).catch(() => {});

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("rejects pending pull after throw", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn
    })();

    const pending = iterator.next();

    await iterator.throw?.(new Error("fail")).catch(() => {});

    await expectAsync(pending)
      .toBeRejectedWithError("fail");
  });

  it("preserves buffered order", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn
    })();

    iterator.next();

    capture.receiver!.next(1);
    capture.receiver!.next(2);
    capture.receiver!.next(3);

    await flush();

    expect((iterator as any).__tryNext()).toEqual(NEXT(2));
    expect((iterator as any).__tryNext()).toEqual(NEXT(3));
    expect((iterator as any).__tryNext()).toBeNull();
  });

  it("buffers __pushNext before registration", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn
    })();

    (iterator as any).__pushNext(123);

    expect(await iterator.next()).toEqual(NEXT(123));
  });

  it("buffers completion before registration", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn
    })();

    (iterator as any).__pushComplete();

    expect(await iterator.next()).toEqual(DONE);
  });

  it("buffers error before registration", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn
    })();

    (iterator as any).__pushError(new Error("boom"));

    await expectAsync(iterator.next())
      .toBeRejectedWithError("boom");
  });

  it("conflates pending pushes", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn,
      conflate: true
    })();

    (iterator as any).__pushNext(1);
    (iterator as any).__pushNext(2);
    (iterator as any).__pushNext(3);

    expect(await iterator.next()).toEqual(NEXT(3));
  });

  it("marks observer disposed after return", async () => {
    const capture = createRegisterCapture();

    const iterator = createAsyncIterator<number>({
      register: capture.fn
    })();

    iterator.next();

    expect(capture.receiver!.disposed).toBeFalse();

    await iterator.return?.();

    expect(capture.receiver!.disposed).toBeTrue();
  });
});


function createRegisterCapture() {
  let receiver: TestObserver<number> | null = null;
  const fn = (r: TestObserver<number>) => {
    receiver = r;
    return createSubscription();
  };
  return { fn, get receiver() { return receiver; } };
}
