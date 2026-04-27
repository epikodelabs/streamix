import {
    createOperator,
    DONE,
    isPromiseLike,
    NEXT,
    type MaybePromise,
    type Operator,
    type Stream,
} from "../abstractions";
import { fromAny } from '../converters';

  const RAW = Symbol.for("streamix.rawAsyncIterator");

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
  project: (value: T) => MaybePromise<Stream<T> | Array<T> | T>,
  options: ExpandOptions = {}
): Operator<T, T> =>
  createOperator<T, T>('expand', function (this: Operator, source) {
    type QueueItem = {
      result: IteratorResult<T>;
      depth: number;
    };
    const queue: QueueItem[] = [];
    let sourceDone = false;

    const enqueueChildren = async (
      value: T,
      depth: number
    ) => {
      if (options.maxDepth !== undefined && depth >= options.maxDepth) return;

      const projected = project(value);
      const normalized = isPromiseLike(projected) ? await projected : projected;

      const stream = fromAny(normalized);
      const iterator = ((stream as any)[RAW]?.() ?? stream[Symbol.asyncIterator]()) as AsyncIterator<T>;

      while (true) {
        const child = await iterator.next();
        if (child.done) break;
        const item = { result: child, depth: depth + 1 };
        if (options.traversal === 'breadth') {
          queue.push(item);
        } else {
          queue.unshift(item);
        }
      }
    };

    const iterator: AsyncIterator<T> = {
      next: async () => {
        while (true) {
          while (queue.length === 0 && !sourceDone) {
            const result = await source.next();
            if (result.done) {
              sourceDone = true;
              break;
            }

            if ((result as any).dropped) return result as any;

            queue.push({ result, depth: 0 });
          }

          if (queue.length > 0) {
            const item =
              options.traversal === 'breadth' ? queue.shift()! : queue.pop()!;
            if ((item.result as any).dropped) return item.result as any;
            await enqueueChildren(item.result.value, item.depth);
            return NEXT(item.result.value);
          }

          if (sourceDone && queue.length === 0) {
            return DONE;
          }

          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      },

      async return(value?: any) {
        queue.length = 0;
        try {
          await source.return?.(value);
        } catch {}
        return DONE;
      },

      async throw(err: any) {
        queue.length = 0;
        try {
          await source.return?.();
        } catch {}
        throw err;
      }
    };

    return iterator;
  });
