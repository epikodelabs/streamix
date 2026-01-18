import { createOperator, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject, type Subject } from '../subjects';

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

  const connect = (source: AsyncIterator<T>) => {
    isConnected = true;
    (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;
          shared!.next(result.value);
        }
      } catch (err) {
        shared!.error(err);
        return;
      } finally {
        shared!.complete();
      }
    })();
  };

  return createOperator<T, T>('share', function (this: Operator, source) {
    if (!shared) shared = createSubject<T>();
    if (!isConnected) {
      connect(source);
    }

    return eachValueFrom(shared);
  });
}
