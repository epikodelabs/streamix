import { atom, createOperator, DONE, iterate, type Operator, type Writable } from "../atoms";
import { normalizeError } from "../atoms";

/**
 * Shares a single subscription to the source stream between multiple consumers.
 *
 * This operator multicasts the upstream iterator through an internal subject so
 * that every subsequent consumer receives the same values without re-running the source.
 * Because the shared subject is an Atom, a late consumer first receives the
 * subject's current value when one exists, then continues with live emissions.
 * This is a one-value current snapshot, not a replay history; use `shareReplay()`
 * when multiple past values must be retained.
 * After upstream completion or the last consumer's cancellation, a subsequent
 * `apply(source)` starts a fresh session with a new subject. A completed pipe
 * remains terminal; construct a new pipe to supply a new upstream iterator.
 *
 * **Timing caveat:** values produced before the internal subject has acquired a
 * current value are not recoverable, and only the latest current value is visible
 * to a later consumer.
 *
 * @template T Value type in the shared stream.
 * @returns An operator that can be inserted into a pipeline to share the source.
 */
export function share<T = any>() {
  let shared: Writable<T> | undefined;
  let isConnected = false;
  let sourceIterator: AsyncIterator<T> | null = null;
  let subscriberCount = 0;
  let activeConnection: symbol | null = null;

  const disconnect = () => {
    if (sourceIterator) {
      const it = sourceIterator;
      sourceIterator = null;
      isConnected = false;
      activeConnection = null;
      shared?.dispose();
      void it.return?.().catch(() => {});
    }
  };

  const connect = (source: AsyncIterator<T>) => {
    const subject = shared!;
    const connection = Symbol('shareConnection');
    activeConnection = connection;
    sourceIterator = source;
    isConnected = true;
    void (async () => {
      try {
        while (activeConnection === connection) {
          const result = await source.next();
          if (activeConnection !== connection) return;
          if (result.done) break;

          subject.next(result.value);
        }
      } catch (err) {
        if (activeConnection === connection) subject.fail(normalizeError(err));
        return;
      } finally {
        if (activeConnection === connection) {
          sourceIterator = null;
          isConnected = false;
          activeConnection = null;
          subject.dispose();
        }
      }
    })();
  };

  return createOperator<T, T>('share', function (this: Operator, source) {
    if (!shared || shared.disposed) {
      shared = atom<T>();
      subscriberCount = 0;
    }
    if (!isConnected) {
      connect(source);
    } else if (typeof source.return === "function") {
      // Each `for await` on the piped stream creates a fresh upstream iterator.
      // Once we're connected, we must close these unused iterators immediately,
      // otherwise they remain subscribed and can backpressure the shared source.
      Promise.resolve(source.return()).catch(() => {});
    }

    subscriberCount++;
    const subject = shared;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (shared !== subject) return;
      subscriberCount--;
      if (subscriberCount === 0 && isConnected) disconnect();
    };
    const outputIterator = iterate(shared)[Symbol.asyncIterator]();
    const baseNext = outputIterator.next.bind(outputIterator);
    outputIterator.next = async () => {
      try {
        const result = await baseNext();
        if (result.done) release();
        return result;
      } catch (err) {
        release();
        throw err;
      }
    };
    const baseReturn = outputIterator.return?.bind(outputIterator);
    const baseThrow = outputIterator.throw?.bind(outputIterator);

    (outputIterator as any).return = async (value?: any) => {
      release();
      return baseReturn ? baseReturn(value) : DONE;
    };

    // Note: throw() intentionally does not release the shared subscription.
    // An injected error may be recoverable, so the consumer can keep iterating;
    // only return() is a definitive teardown.
    (outputIterator as any).throw = async (err: any) => {
      const error = normalizeError(err);
      if (baseThrow) return baseThrow(error);
      throw error;
    };

    return outputIterator;
  });
}
