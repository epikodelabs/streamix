import type { MaybePromise } from '../atoms/operator';
import type { PipeInput } from '../atoms/pipe';
import type { ɵDisposalQueue } from '../utils/disposal';
import { isAsyncIterable, isIterable } from '../utils/helpers';

/** Reserves ownership before calling a projector that may synchronously cancel its consumer. */
export function prepareProjection<T>(
  disposal: ɵDisposalQueue,
  project: () => MaybePromise<PipeInput<T>>,
  publish: (value: MaybePromise<PipeInput<T>>) => boolean,
): void {
  const preparation = Promise.withResolvers<void>();
  disposal.track(preparation.promise);
  try {
    const projected = project();
    preparation.resolve(publish(projected) ? undefined : closeUnpublishedProjection(projected));
  } catch (error) {
    preparation.resolve();
    throw error;
  }
}

async function closeUnpublishedProjection<T>(projected: MaybePromise<PipeInput<T>>): Promise<void> {
  try {
    const value = await projected;
    if (isAsyncIterable(value)) {
      await value[Symbol.asyncIterator]().return?.();
    } else if (typeof value !== 'string' && isIterable(value)) {
      await value[Symbol.iterator]().return?.();
    }
  } catch { /* A discarded projection cannot replace the consumer's terminal result. */ }
}
