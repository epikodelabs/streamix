import { createOperator, DONE, setIteratorMeta, setValueMeta, type IteratorMetaKind, type Operator } from '../abstractions';
import { eachValueFrom } from '../converters';
import { createSubject, type Subject } from '../subjects';

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

/** Async iterator augmented with push methods, passed to operator setup callbacks. */
export type AsyncOutput<R> = AsyncIterator<R> & {
  /** Emit a value downstream, optionally attaching trace metadata. */
  emit(value: R, meta?: { valueId: string; operatorIndex: number; operatorName: string }, tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }): void;
  error(err: any): void;
  complete(): void;
  completed(): boolean;
};

/**
 * Creates an operator backed by an internal Subject for asynchronous decoupling.
 *
 * The `setup` callback receives `source` and an `output` iterator.
 * `output` is both an `AsyncIterator` (returned to downstream) and has push
 * methods (`emit`, `error`, `complete`, `completed`) for producing values.
 *
 * @template T Input value type.
 * @template R Output value type (defaults to T).
 * @param name Operator name for debugging/tracing.
 * @param setup Initialization function. May return a cleanup callback.
 */
export function createAsyncOperator<T, R = T>(
  name: string,
  setup: (source: AsyncIterator<T>, output: AsyncOutput<R>) => void | (() => void | Promise<void>)
): Operator<T, R> {
  return createOperator<T, R>(name, function (this: Operator, source) {
    const subject: Subject<R> = createSubject<R>();
    const output = Object.assign(eachValueFrom(subject), {
      emit: (value: R, meta?: any, tag?: any) => subject.next(tagValue(output, value, meta, tag)),
      error: (err: any) => subject.error(err),
      complete: () => subject.complete(),
      completed: () => subject.completed(),
    }) as AsyncOutput<R>;

    const cleanup = setup(source, output);

    const baseReturn = output.return?.bind(output);
    const baseThrow = output.throw?.bind(output);

    (output as any).return = async (value?: any) => {
      if (cleanup) await cleanup();
      try { await source.return?.(); } catch {}
      if (!subject.completed()) subject.complete();
      return baseReturn ? baseReturn(value) : DONE;
    };

    (output as any).throw = async (err: any) => {
      if (cleanup) await cleanup();
      try { await source.return?.(); } catch {}
      if (!subject.completed()) subject.error(err);
      if (baseThrow) return baseThrow(err);
      throw err;
    };

    return output;
  });
}
