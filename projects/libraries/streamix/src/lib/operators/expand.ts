import { normalizeError } from '../utils/helpers';
import { createOperator, DONE, isPromiseLike, NEXT, type MaybePromise, type Operator } from "../abstractions";
import { from } from '../streams/from';


/**
 * Options for the expand operator.
 *
 * @property {'depth' | 'breadth'} [traversal] - Traversal strategy: 'depth' (default) or 'breadth'.
 * @property {number} [maxDepth] - Maximum recursion depth.
 */
export type ExpandOptions = {
  traversal?: 'depth' | 'breadth';
  maxDepth?: number;
  /** Wait for in-flight projection and late child cleanup on cancellation. Defaults to true. */
  awaitPendingProjection?: boolean;
};

/**
 * Creates a stream operator that recursively expands each emitted value.
 *
 * This operator takes each value from the source stream and applies the `project`
 * function to it, which must return a new stream. It then recursively applies
 * the same logic to each value emitted by that new stream, effectively
 * flattening an infinitely deep, asynchronous data structure.
 * Each value is emitted after its projection resolves, before pulling any of
 * its children. Child iterators are consumed incrementally rather than being
 * collected to completion. Traversal applies to each source root in order.
 * Depth-first retains suspended ancestor iterators; breadth-first retains the
 * next-level frontier, which can grow for an infinitely wide level.
 * Teardown aborts the projector's signal and waits for any child it creates to
 * close. Set `awaitPendingProjection: false` for projectors that may never
 * settle. A child that becomes available later is still closed.
 *
 * This is particularly useful for traversing graph or tree-like data, such as
 * file directories or hierarchical API endpoints, where each item might lead
 * to a new collection of items that also need to be processed.
 *
 * @template T The type of the values in the source and output streams.
 * @param project A function that takes a value and returns a stream, value/array,
 * or a promise of those shapes to be expanded.
 * @param options An optional configuration object for traversal strategy and max depth.
 * @returns An `Operator` instance that can be used in a stream's `pipe` method.
 */
export const expand = <T = any>(
  project: (value: T, signal: AbortSignal) => MaybePromise<AsyncIterable<T> | Iterable<T> | T>,
  options: ExpandOptions = {}
): Operator<T, T> =>
  createOperator<T, T>('expand', function (this: Operator, source) {
    type Frame = {
      iterator: AsyncIterator<T>;
      depth: number;
      next?: Frame;
    };
    let head: Frame | undefined;
    let tail: Frame | undefined;
    let stopped = false;
    let closing: Promise<void> | undefined;
    const controller = new AbortController();
    const preparations = new Set<Promise<void>>();
    const sourceFrame: Frame = { iterator: source, depth: 0 };

    const closeIterator = async (iterator: AsyncIterator<T>) => {
      try { await iterator.return?.(); } catch { /* Best-effort cleanup. */ }
    };

    const close = (): Promise<void> => {
      if (closing) return closing;
      stopped = true;
      closing = Promise.resolve().then(async () => {
        controller.abort();
        const pending: Promise<void>[] = [];
        for (let frame = head; frame; frame = frame.next) {
          pending.push(closeIterator(frame.iterator));
      }
        head = tail = undefined;
        // Close suspended ancestors and the source independently of the active child.
        pending.push(closeIterator(source));
        if (options.awaitPendingProjection !== false) pending.push(...preparations);
        await Promise.allSettled(pending);
      });
      return closing;
    };

    const enqueueChildren = async (value: T, depth: number) => {
      if (options.maxDepth !== undefined && depth >= options.maxDepth) return;
      const projected = project(value, controller.signal);
      const normalized = isPromiseLike(projected) ? await projected : projected;
      // Preserve native iterator cancellation, and don't eagerly materialize
      // synchronous iterables (which may themselves be infinite). Strings
      // retain from()'s scalar-value contract.
      const iterable = normalized as Partial<AsyncIterable<T> & Iterable<T>> | null;
      const iterator = iterable?.[Symbol.asyncIterator]?.()
        ?? (typeof normalized !== 'string' && iterable?.[Symbol.iterator]
          ? from(iterable as Iterable<T>)[Symbol.asyncIterator]()
          : from<T>([normalized as T])[Symbol.asyncIterator]());
      if (stopped) {
        await closeIterator(iterator);
        return;
      }
      const frame: Frame = { iterator, depth: depth + 1 };
      if (options.traversal === 'breadth') {
        if (tail) tail.next = frame;
        else head = frame;
        tail = frame;
      } else {
        frame.next = head;
        head = frame;
        tail ??= frame;
      }
    };

    const iterator: AsyncIterator<T> = {
      next: async () => {
        try {
          while (true) {
            if (stopped) return DONE;
            const frame = head ?? sourceFrame;
            const result = await frame.iterator.next();
            if (stopped) return DONE;
            if (result.done) {
              if (frame === sourceFrame) {
                stopped = true;
                return DONE;
              }
              head = frame.next;
              if (!head) tail = undefined;
              frame.next = undefined;
              continue;
            }
            // Register preparation before calling user code, which may
            // synchronously reenter return() or throw().
            const preparation = Promise.resolve().then(async () => {
              if (!stopped) await enqueueChildren(result.value, frame.depth);
            });
            preparations.add(preparation);
            try { await preparation; }
            finally { preparations.delete(preparation); }
            if (stopped) return DONE;
            return NEXT(result.value);
          }
        } catch (error) {
          if (stopped) return DONE;
          await close();
          throw error;
        }
      },

      async return() {
        await close();
        return DONE;
      },

      async throw(err: any) {
        await close();
        throw normalizeError(err);
      }
    };

    return iterator;
  });
