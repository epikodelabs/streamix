import { createOperator, DONE, type Operator } from '../abstractions';
import { createSubject, type Subject } from '../subjects';
import { normalizeError } from '../utils/helpers';

/**
 * Shares a single subscription to the source stream between multiple consumers.
 *
 * This operator multicasts the upstream iterator through an internal subject so
 * that every subsequent consumer receives the same values without re-running the source.
 * The subject does not replay values for late subscribers; they receive only values
 * emitted after they subscribe.
 *
 * @template T Value type in the shared stream.
 * @returns An operator that can be inserted into a pipeline to share the source.
 */
export function share<T = any>() {
  let shared: Subject<T> | undefined;
  let isConnected = false;
  let sourceIterator: AsyncIterator<T> | null = null;
  let subscriberCount = 0;
  let connection: object | undefined;

  const disconnect = (): Promise<void> | undefined => {
    if (sourceIterator) {
      const it = sourceIterator;
      sourceIterator = null;
      isConnected = false;
      connection = undefined;
      shared?.complete();
      return closeSource(it);
    }
    return undefined;
  };

  const closeSource = async (source: AsyncIterator<T>) => {
    try { await source.return?.(); } catch { /* Best-effort upstream cleanup. */ }
  };

  const connect = (source: AsyncIterator<T>) => {
    const subject = shared!;
    const active = connection = {};
    sourceIterator = source;
    isConnected = true;
    void (async () => {
      try {
        while (connection === active) {
          const result = await source.next();
          if (connection !== active || result.done) break;

          subject.next(result.value);
        }
      } catch (err) {
        if (connection === active) subject.error(normalizeError(err));
        return;
      } finally {
        if (connection === active) {
          connection = undefined;
          isConnected = false;
          sourceIterator = null;
          if (!subject.completed()) subject.complete();
        }
      }
    })();
  };

  return createOperator<T, T>('share', function (this: Operator, source) {
    if (!shared || shared.completed()) {
      shared = createSubject<T>();
      subscriberCount = 0;
    }
    const subject = shared;
    let released = false;
    let teardown: Promise<void> | undefined;
    const release = () => {
      if (!released && subject === shared) {
        released = true;
        if (--subscriberCount === 0 && isConnected) teardown = disconnect();
      }
      return teardown;
    };
    const outputIterator = shared[Symbol.asyncIterator]();
    const baseReturn = outputIterator.return?.bind(outputIterator);
    const baseThrow = outputIterator.throw?.bind(outputIterator);
    subscriberCount++;

    if (!isConnected) {
      connect(source);
    } else if (source !== sourceIterator) {
      // Each `for await` on the piped stream creates a fresh upstream iterator.
      // Once we're connected, we must close these unused iterators immediately,
      // otherwise they remain subscribed and can backpressure the shared source.
      void closeSource(source);
    }

    (outputIterator as any).return = async (value?: any) => {
      await release();
      return baseReturn ? baseReturn(value) : DONE;
    };

    (outputIterator as any).throw = async (err: any) => {
      const error = normalizeError(err);
      await release();
      if (baseThrow) return baseThrow(error);
      throw error;
    };

    return outputIterator;
  });
}
