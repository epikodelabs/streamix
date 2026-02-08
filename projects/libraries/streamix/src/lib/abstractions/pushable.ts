import { IteratorMetaKind } from "./hooks";
import { createAsyncIterator, tagValue } from "./iterator";
import { Receiver } from "./receiver";
import { createSubscription } from "./subscription";

/**
 * Async iterator augmented with push methods, passed to operator setup callbacks.
 */
export type AsyncPushable<R> = AsyncIterator<R> & AsyncIterable<R> & {
  push(
    value: R,
    meta?: { valueId: string; operatorIndex: number; operatorName: string },
    tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }
  ): void | Promise<void>;
  error(err: any): void;
  complete(): void;
  completed(): boolean;
};

/**
 * Creates an `AsyncPushable` backed by `createAsyncIterator`.
 *
 * Internally wires a `createAsyncIterator({ register, lazy: false })` so
 * that the receiver is captured immediately.  The `push`/`error`/`complete`
 * methods delegate to the captured receiver, making this a thin wrapper.
 */
export function createAsyncPushable<R>(): AsyncPushable<R> {
  let receiver: Receiver<R> | null = null;

  const factory = createAsyncIterator<R>({
    register(r) {
      receiver = r;
      // The subscription is not meaningful here – push/error/complete
      // control the flow, not an external source.
      return createSubscription();
    },
    lazy: false, // capture receiver immediately
  });

  const iterator = factory() as any;

  // Augment the iterator with the AsyncPushable surface.
  iterator[Symbol.asyncIterator] = function () { return this; };

  iterator.push = function (
    value: R,
    meta?: { valueId: string; operatorIndex: number; operatorName: string },
    tag?: { kind?: IteratorMetaKind; inputValueIds?: string[] }
  ): void | Promise<void> {
    const v = tagValue(iterator, value, meta, tag);
    return receiver!.next!(v);
  };

  iterator.error = function (err: any) {
    receiver!.error!(err);
  };

  iterator.complete = function () {
    receiver!.complete!();
  };

  iterator.completed = function () {
    return (receiver as any)?.completed ?? false;
  };

  return iterator as AsyncPushable<R>;
}