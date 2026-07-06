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
});


function createRegisterCapture() {
  let receiver: TestObserver<number> | null = null;
  const fn = (r: TestObserver<number>) => {
    receiver = r;
    return createSubscription();
  };
  return { fn, get receiver() { return receiver; } };
}
