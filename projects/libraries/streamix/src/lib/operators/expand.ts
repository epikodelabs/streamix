import { __streamixBeginLifetime, type StreamixLifetimeSpan } from '../runtime/introspection-hooks';
import { createOperator, DONE, isPromiseLike, NEXT, type MaybePromise, type Operator } from "../atoms";
import { toAsyncIterable, type PipeInput } from "../atoms/pipe";
import { from } from '../factories';
import { normalizeError } from "../atoms";
import { isAsyncIterable, isIterable } from '../utils/helpers';

/**
 * Options for the expand operator.
 *
 * @property {'depth' | 'breadth'} [traversal] - Traversal strategy: 'depth' (default) or 'breadth'.
 * @property {number} [maxDepth] - Maximum recursion depth.
 */
export type ExpandOptions = {
  traversal?: 'depth' | 'breadth';
  maxDepth?: number;
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
  project: (value: T) => MaybePromise<PipeInput<T> | Array<T> | T>,
  options: ExpandOptions = {}
): Operator<T, T> =>
  createOperator<T, T>('expand', function (this: Operator, source) {
    type Frame = {
      iterator: AsyncIterator<T>;
      depth: number;
      lifetime?: StreamixLifetimeSpan;
      next?: Frame;
    };
    let head: Frame | undefined;
    let tail: Frame | undefined;
    let stopped = false;
    let closing: Promise<void> | undefined;
    let preparing: StreamixLifetimeSpan | undefined;
    const sourceFrame: Frame = { iterator: source, depth: 0 };

    const closeIterator = async (iterator: AsyncIterator<T>) => {
      try { await iterator.return?.(); } catch { /* Best-effort cleanup. */ }
    };

    const close = (outcome: 'cancel' | 'error'): Promise<void> => {
      if (closing) return closing;
      stopped = true;
      preparing?.finish(outcome);
      preparing = undefined;
      const pending: Promise<void>[] = [];
      for (let frame = head; frame; frame = frame.next) {
        frame.lifetime?.finish(outcome);
        pending.push(closeIterator(frame.iterator));
      }
      head = tail = undefined;
      // Close suspended ancestors and the source independently of a possibly
      // pending pull on the active child.
      pending.push(closeIterator(source));
      closing = Promise.all(pending).then(() => {});
      return closing;
    };

    const enqueueChildren = async (value: T, depth: number) => {
      if (options.maxDepth !== undefined && depth >= options.maxDepth) return;

      // Each span covers one direct child enumeration, not the whole subtree.
      const lifetime = __streamixBeginLifetime(this);
      lifetime?.start();
      preparing = lifetime;
      try {
        const projected = project(value);
        const normalized = isPromiseLike(projected) ? await projected : projected;
        // Preserve native iterator cancellation, and don't eagerly materialize
        // synchronous iterables (which may themselves be infinite). Strings
        // retain from()'s scalar-value contract.
        const stream = isAsyncIterable(normalized) || (typeof normalized !== 'string' && isIterable(normalized))
          ? toAsyncIterable<T>(normalized)
          : from<T>(normalized);
        const iterator = stream[Symbol.asyncIterator]();
        if (stopped) {
          await closeIterator(iterator);
          return;
        }
        const frame: Frame = { iterator, depth: depth + 1, lifetime };
        if (options.traversal === 'breadth') {
          if (tail) tail.next = frame;
          else head = frame;
          tail = frame;
        } else {
          frame.next = head;
          head = frame;
          tail ??= frame;
        }
      } catch (error) {
        if (!stopped) lifetime?.finish('error');
        throw error;
      } finally {
        preparing = undefined;
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
              frame.lifetime?.finish('complete');
              if (frame === sourceFrame) {
                stopped = true;
                return DONE;
              }
              head = frame.next;
              if (!head) tail = undefined;
              frame.next = undefined;
              continue;
            }
            frame.lifetime?.output();
            await enqueueChildren(result.value, frame.depth);
            if (stopped) return DONE;
            return NEXT(result.value);
          }
        } catch (error) {
          if (stopped) return DONE;
          await close('error');
          throw error;
        }
      },

      async return() {
        await close('cancel');
        return DONE;
      },

      async throw(err: any) {
        await close('error');
        throw normalizeError(err);
      }
    };

    return iterator;
  });
