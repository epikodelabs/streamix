import type { Receiver, StrictReceiver } from '@epikodelabs/streamix';
import {
  createAsyncIterator,
  createSubscription,
  DONE,
  NEXT
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

    it('drops buffered values after return', async () => {
      const registerCapture = createRegisterCapture();
      const iterator = createAsyncIterator<number>({ register: registerCapture.fn })();

      iterator.next();
      registerCapture.receiver!.next(1);
      await flush();

      registerCapture.receiver!.next(2);
      await iterator.return?.();

      expect(await iterator.next()).toEqual(DONE);
      expect((iterator as any).__tryNext?.()).toEqual(DONE);
    });

    it('drops buffered values after throw', async () => {
      const registerCapture = createRegisterCapture();
      const iterator = createAsyncIterator<number>({ register: registerCapture.fn })();

      iterator.next();
      registerCapture.receiver!.next(1);
      await flush();

      registerCapture.receiver!.next(2);
      await expectAsync(iterator.throw?.(new Error('stop'))).toBeRejectedWithError('stop');

      expect(await iterator.next()).toEqual(DONE);
      expect((iterator as any).__tryNext?.()).toEqual(DONE);
    });

    it('retries registration after a synchronous register failure', async () => {
      let attempts = 0;
      let receiver: StrictReceiver<number> | null = null;

      const iterator = createAsyncIterator<number>({
        register: (r: Receiver<number>) => {
          attempts++;
          if (attempts === 1) {
            throw new Error('boom');
          }
          receiver = r as StrictReceiver<number>;
          return createSubscription();
        }
      })();

      await expectAsync(iterator.next()).toBeRejectedWithError('boom');

      const pending = iterator.next();
      receiver!.next(5);

      expect(await pending).toEqual(NEXT(5));
      expect(attempts).toBe(2);
    });

    it('does not conflate over queued completion before first pull', async () => {
      const iterator: any = createAsyncIterator<number>({
        register: () => createSubscription(),
        conflate: true
      })();

      iterator.__pushNext?.(1);
      iterator.__pushComplete?.();
      iterator.__pushNext?.(2);

      expect(await iterator.next()).toEqual(NEXT(1));
      expect(await iterator.next()).toEqual(DONE);
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
