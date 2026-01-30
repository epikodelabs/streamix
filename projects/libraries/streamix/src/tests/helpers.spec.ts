import type { MaybePromise, QueueItem, Receiver, StrictReceiver } from '@epikodelabs/streamix';
import {
  createAsyncIterator,
  createRegister,
  createSubscription,
  createTryCommit
} from '@epikodelabs/streamix';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('helpers', () => {
  describe('createTryCommit', () => {
    const makeReceiver = (options: {
      onNext?: (value: number) => void;
      onComplete?: () => void;
      onError?: (err: any) => void;
      asyncOnce?: boolean;
    } = {}): StrictReceiver<number> => {
      const { onNext = () => {}, onComplete = () => {}, onError = () => {}, asyncOnce } = options;
      let completed = false;
      return {
        next(value: number) {
          onNext(value);
          if (asyncOnce && value === 1) {
            return new Promise<void>((resolve) => {
              setTimeout(resolve, 0);
            });
          }
          return undefined;
        },
        complete() {
          completed = true;
          onComplete();
        },
        error(err) {
          completed = true;
          onError(err);
        },
        get completed() {
          return completed;
        },
      };
    };

    it('delivers queued values when every receiver is ready', () => {
      const receivers = new Set<StrictReceiver<number>>();
      const ready = new Set<StrictReceiver<number>>();
      const queue: QueueItem<number>[] = [
        { kind: 'next', value: 1, stamp: 1 },
        { kind: 'next', value: 2, stamp: 2 },
      ];
      const values: number[] = [];
      const receiver = makeReceiver({ onNext: value => values.push(value) });
      receivers.add(receiver);
      ready.add(receiver);

      const setLatestValue = jasmine.createSpy('setLatestValue');
      const tryCommit = createTryCommit({
        receivers,
        ready,
        queue,
        setLatestValue,
      });

      tryCommit();
      tryCommit();

      expect(values).toEqual([1, 2]);
      expect(setLatestValue.calls.allArgs()).toEqual([[1], [2]]);
      expect(queue.length).toBe(0);
      expect(ready.has(receiver)).toBeTrue();
    });

    it('waits for async receivers before continuing commit', async () => {
      const receivers = new Set<StrictReceiver<number>>();
      const ready = new Set<StrictReceiver<number>>();
      const queue: QueueItem<number>[] = [
        { kind: 'next', value: 1, stamp: 1 },
        { kind: 'next', value: 2, stamp: 2 },
      ];
      const delivered: number[] = [];
      const receiver = makeReceiver({
        onNext: value => delivered.push(value),
        asyncOnce: true,
      });
      receivers.add(receiver);
      ready.add(receiver);

      const setLatestValue = jasmine.createSpy('setLatestValue');
      const tryCommit = createTryCommit({
        receivers,
        ready,
        queue,
        setLatestValue,
      });

      tryCommit();

      await flush();
      await flush();

      expect(delivered).toEqual([1, 2]);
      expect(setLatestValue.calls.allArgs()).toEqual([[1], [2]]);
      expect(queue.length).toBe(0);
      expect(ready.has(receiver)).toBeTrue();
    });

    it('clears receivers on complete', () => {
      const receivers = new Set<StrictReceiver<number>>();
      const ready = new Set<StrictReceiver<number>>();
      const queue: QueueItem<number>[] = [{ kind: 'complete', stamp: 123 }];
      const completions: string[] = [];

      const receiver = makeReceiver({
        onComplete: () => completions.push('c'),
      });
      receivers.add(receiver);
      ready.add(receiver);

      const tryCommit = createTryCommit({
        receivers,
        ready,
        queue,
        setLatestValue: () => {},
      });

      tryCommit();

      expect(completions).toEqual(['c']);
      expect(receivers.size).toBe(0);
      expect(ready.size).toBe(0);
      expect(queue.length).toBe(0);
    });

    it('propagates errors to receivers and flushes queue', () => {
      const receivers = new Set<StrictReceiver<number>>();
      const ready = new Set<StrictReceiver<number>>();
      const err = new Error('boom');
      const queue: QueueItem<number>[] = [{ kind: 'error', error: err, stamp: 99 }];
      const received: any[] = [];

      const receiver = makeReceiver({
        onError: error => received.push(error),
      });
      receivers.add(receiver);
      ready.add(receiver);

      const tryCommit = createTryCommit({
        receivers,
        ready,
        queue,
        setLatestValue: () => {},
      });

      tryCommit();

      expect(received).toEqual([err]);
      expect(receivers.size).toBe(0);
      expect(ready.size).toBe(0);
      expect(queue.length).toBe(0);
    });
  });

  describe('createRegister', () => {
    it('completes late subscribers immediately', () => {
      const receivers = new Set<StrictReceiver<number>>();
      const ready = new Set<StrictReceiver<number>>();
      const terminalRef = { current: { kind: 'complete', stamp: 5 } as QueueItem<number> | null };
      const subscribeComplete = jasmine.createSpy('complete');
      const register = createRegister<number>({
        receivers,
        ready,
        terminalRef,
        createSubscription: () => createSubscription(),
        tryCommit: () => {},
      });

      register({
        next: () => {},
        complete: subscribeComplete,
        error: () => {},
      });

      expect(subscribeComplete).toHaveBeenCalled();
    });

    it('tracks active receivers and cleans up on unsubscribe', async () => {
      const receivers = new Set<StrictReceiver<number>>();
      const ready = new Set<StrictReceiver<number>>();
      const terminalRef = { current: null as QueueItem<number> | null };
      const cleanup: string[] = [];
      const tryCommitSpy = jasmine.createSpy('tryCommit');
      const register = createRegister<number>({
        receivers,
        ready,
        terminalRef,
        createSubscription: (onUnsubscribe?: () => MaybePromise<void>) =>
          createSubscription(onUnsubscribe),
        tryCommit: tryCommitSpy,
      });

      const rec: Receiver<number> = {
        next: () => {},
        complete: () => cleanup.push('c'),
        error: () => {},
      };

      const subscription = register(rec);

      expect(receivers.size).toBe(1);
      expect(ready.size).toBe(1);
      expect(tryCommitSpy).toHaveBeenCalled();

      await subscription.unsubscribe();
      expect(checkSetsEmpty(receivers, ready)).toBeTrue();
      expect(cleanup).toEqual(['c']);
    });
  });

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
      expect(await donePull).toEqual({ done: true, value: undefined });

      const returned = await iterator.return?.();
      expect(returned).toEqual({ done: true, value: undefined });
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
});

function checkSetsEmpty(
  receivers: Set<StrictReceiver<number>>,
  ready: Set<StrictReceiver<number>>
): boolean {
  return receivers.size === 0 && ready.size === 0;
}

function createRegisterCapture() {
  let receiver: StrictReceiver<number> | null = null;
  const fn = (r: Receiver<number>) => {
    receiver = r as StrictReceiver<number>;
    return createSubscription();
  };
  return { fn, get receiver() { return receiver; } };
}
