import { createOperator, DONE, MaybePromise, setIteratorMeta, setValueMeta, type IteratorMetaKind, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject } from '../subjects';

/**
 * Attaches tracing metadata to both an iterator and a value in a single call.
 *
 * Consolidates the common `setIteratorMeta` + `setValueMeta` pattern.
 * Returns the (possibly wrapped) value.
 *
 * @param iterator The async iterator to tag.
 * @param value The value to tag.
 * @param meta Metadata from `getIteratorMeta(source)`. If `undefined`, the value is returned unchanged.
 * @param tag Optional additional tag fields (kind, inputValueIds).
 */
export function tagValue<T>(
  iterator: AsyncIterator<any>,
  value: T,
  meta: { valueId: string; operatorIndex: number; operatorName: string } | undefined,
  tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }
): T {
  if (!meta) return value;
  const metaTag = { valueId: meta.valueId, ...tag };
  setIteratorMeta(iterator, metaTag, meta.operatorIndex, meta.operatorName);
  return setValueMeta(value, metaTag, meta.operatorIndex, meta.operatorName);
}

/**
 * Async iterator augmented with push methods, passed to operator setup callbacks.
 */
export type AsyncPushable<R> = AsyncIterator<R> & {
  push(
    value: R,
    meta?: { valueId: string; operatorIndex: number; operatorName: string },
    tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }
  ): void;
  error(err: any): void;
  complete(): void;
  completed(): boolean;
};

/**
 * Creates an `AsyncPushable` backed by an internal `Subject`.
 */
export function createAsyncPushable<R>(): AsyncPushable<R> {
  const subject = createSubject<R>();

  const output = Object.assign(eachValueFrom(subject), {
    push: (value: R, meta?: any, tag?: any) => subject.next(tagValue(output, value, meta, tag)),
    error: (err: any) => subject.error(err),
    complete: () => subject.complete(),
    completed: () => subject.completed(),
  }) as AsyncPushable<R>;

  return output;
}

/**
 * Creates an async operator where `setup` receives the source iterator and a pre-created output.
 * `setup` may return an optional cleanup callback that is invoked when the downstream cancels
 * iteration (`return()` / `throw()`).
 */
export function createAsyncOperator<T, R = T>(
  name: string,
  setup: (source: AsyncIterator<T>, output: AsyncPushable<R>) => (this: Operator) => MaybePromise<void>
): Operator<T, R> {
  return createOperator<T, R>(name, function (this: Operator, source) {
    const output = createAsyncPushable<R>();
    const cleanup = setup(source, output);

    let cleanupCalled = false;
    const runCleanup = async () => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      if (!cleanup) return;
      try {
        await cleanup.call(this);
      } catch {
      }
    };

    const baseReturn = output.return?.bind(output);
    const baseThrow = output.throw?.bind(output);

    (output as any).return = async (value?: any) => {
      await runCleanup();
      try { await source.return?.(); } catch {}
      if (!output.completed()) output.complete();
      return baseReturn ? baseReturn(value) : DONE;
    };

    (output as any).throw = async (err: any) => {
      await runCleanup();
      try { await source.return?.(); } catch {}
      if (!output.completed()) output.error(err);
      if (baseThrow) return baseThrow(err);
      throw err;
    };

    return output;
  });
}
