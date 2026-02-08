import type { Receiver, StrictReceiver } from '@epikodelabs/streamix';
import {
    createAsyncIterator,
    createSubscription,
    DONE
} from '@epikodelabs/streamix';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createAsyncIterator', () => {
    it('delivers values via for-await-of and supports return', async () => {
      const registered: Receiver<number>[] = [];
      const register = (receiver: Receiver<number>) => {
        registered.push(receiver);
        return createSubscription();
      };

      const iterator = createAsyncIterator<number>({ register })();
      const firstPull = iterator.next();

      const firstReceiver = registered[0] as StrictReceiver<number>;
      firstReceiver.next(10);
      expect(await firstPull).toEqual({ done: false, value: 10 });

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
      expect(buffered).toEqual({ done: false, value: 2 });
      expect((iterator as any).__hasBufferedValues?.()).toBeFalse();
    });
});


function createRegisterCapture() {
  let receiver: StrictReceiver<number> | null = null;
  const fn = (r: Receiver<number>) => {
    receiver = r as StrictReceiver<number>;
    return createSubscription();
  };
  return { fn, get receiver() { return receiver; } };
}
