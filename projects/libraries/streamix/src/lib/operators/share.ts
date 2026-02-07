import { createOperator, DONE, getIteratorMeta, setValueMeta, type Operator } from '../abstractions';
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
    void (async () => {
      try {
        while (true) {
          const result = await source.next();
          if (result.done) break;

          const meta = getIteratorMeta(source);
          let value: any = result.value;
          if (meta) {
            value = setValueMeta(value, { valueId: meta.valueId }, meta.operatorIndex, meta.operatorName);
          }

          shared!.next(value);
        }
      } catch (err) {
        shared!.error(err);
        return;
      } finally {
        if (shared && !shared.completed()) shared.complete();
      }
    })();
  };

  return createOperator<T, T>('share', function (this: Operator, source) {
    if (!shared) shared = createSubject<T>();
    if (!isConnected) {
      connect(source);
    } else if (typeof source.return === "function") {
      // Each `for await` on the piped stream creates a fresh upstream iterator.
      // Once we're connected, we must close these unused iterators immediately,
      // otherwise they remain subscribed and can backpressure the shared source.
      Promise.resolve(source.return()).catch(() => {});
    }

    const outputIterator = eachValueFrom(shared);
    const baseReturn = outputIterator.return?.bind(outputIterator);
    const baseThrow = outputIterator.throw?.bind(outputIterator);

    (outputIterator as any).return = async (value?: any) => {
      try {
        await source.return?.();
      } catch {}
      if (shared && !shared.completed()) shared.complete();
      return baseReturn ? baseReturn(value) : DONE;
    };

    (outputIterator as any).throw = async (err: any) => {
      try {
        await source.return?.();
      } catch {}
      if (shared && !shared.completed()) shared.error(err);
      if (baseThrow) return baseThrow(err);
      throw err;
    };

    return outputIterator;
  });
}
