import { atom, createOperator, DONE, iterate, type Atom, type Operator } from "../atoms";
import { normalizeError } from "../utils/helpers";

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
  let shared: Atom<T> | undefined;
  let isConnected = false;
  let sourceIterator: AsyncIterator<T> | null = null;
  let subscriberCount = 0;

  const disconnect = () => {
    if (sourceIterator) {
      const it = sourceIterator;
      sourceIterator = null;
      isConnected = false;
      void it.return?.().catch(() => {});
    }
  };

  const connect = (source: AsyncIterator<T>) => {
    sourceIterator = source;
    isConnected = true;
    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;

          shared!.next(result.value);
        }
      } catch (err) {
        shared!.fail(normalizeError(err));
        return;
      } finally {
        if (shared && !shared.disposed) shared.dispose();
      }
    })();
  };

  return createOperator<T, T>('share', function (this: Operator, source) {
    if (!shared) shared = atom<T>();
    if (!isConnected) {
      connect(source);
    } else if (typeof source.return === "function") {
      // Each `for await` on the piped stream creates a fresh upstream iterator.
      // Once we're connected, we must close these unused iterators immediately,
      // otherwise they remain subscribed and can backpressure the shared source.
      Promise.resolve(source.return()).catch(() => {});
    }

    subscriberCount++;
    const outputIterator = iterate(shared)[Symbol.asyncIterator]();
    const baseReturn = outputIterator.return?.bind(outputIterator);
    const baseThrow = outputIterator.throw?.bind(outputIterator);

    (outputIterator as any).return = async (value?: any) => {
      subscriberCount--;
      if (subscriberCount === 0 && isConnected) {
        disconnect();
      }
      return baseReturn ? baseReturn(value) : DONE;
    };

    (outputIterator as any).throw = async (err: any) => {
      const error = normalizeError(err);
      if (baseThrow) return baseThrow(error);
      throw error;
    };

    return outputIterator;
  });
}
