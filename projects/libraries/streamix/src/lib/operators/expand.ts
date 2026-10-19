import { __streamixBeginLifetime, type StreamixLifetimeSpan } from '../runtime/introspection';
import { SerialInnerExecution } from '../runtime/serial-inner-execution';
import { createOperator, DONE, isPromiseLike, NEXT, type MaybePromise, type Operator } from "../atoms";
import type { PipeInput } from "../atoms/pipe";
import { from } from '../factories';
import { normalizeError } from "../atoms";

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
  project: (value: T) => MaybePromise<PipeInput<T> | Array<T> | T>,
  options: ExpandOptions = {}
): Operator<T, T> =>
  createOperator<T, T>('expand', function (this: Operator, source) {
    type QueueItem = {
      result: IteratorResult<T>;
      depth: number;
    };
    const queue: QueueItem[] = [];
    let sourceDone = false;
    const inner = new SerialInnerExecution<T>();
    let lifetime: StreamixLifetimeSpan | undefined;
    const operator = this;

    const enqueueChildren = async (
      value: T,
      depth: number
    ) => {
      if (options.maxDepth !== undefined && depth >= options.maxDepth) return;

      // Each span covers one direct child enumeration, not the whole subtree.
      lifetime = __streamixBeginLifetime(operator);
      lifetime?.start();
      const projected = project(value);
      const normalized = isPromiseLike(projected) ? await projected : projected;

      if (inner.stopped) return;
      const stream = from(normalized);
      inner.attach(stream[Symbol.asyncIterator]() as AsyncIterator<T>);

      const children: QueueItem[] = [];
      while (true) {
        const child = await inner.next();
        if (inner.stopped) return;
        if (child.done) { lifetime?.finish('complete'); break; }
        lifetime?.output();
        children.push({ result: child, depth: depth + 1 });
      }

      if (options.traversal === 'breadth') {
        queue.push(...children);
      } else {
        // Depth-first: children are explored before pending siblings. Inserting
        // the whole batch at the front keeps left-to-right order within it,
        // which single-item unshifting would reverse.
        queue.unshift(...children);
      }
    };

    const iterator: AsyncIterator<T> = {
      next: async () => {
        try {
          while (true) {
            if (inner.stopped) return DONE;
            while (queue.length === 0 && !sourceDone) {
              const result = await source.next();
              if (inner.stopped) return DONE;
              if (result.done) {
                sourceDone = true;
                break;
              }

              queue.push({ result, depth: 0 });
            }

            if (queue.length > 0) {
              const item = queue.shift()!;
              await enqueueChildren(item.result.value, item.depth);
              if (inner.stopped) return DONE;
              return NEXT(item.result.value);
            }

            if (sourceDone && queue.length === 0) {
              return DONE;
            }

            // Yield to microtask queue to avoid starving the event loop
            await new Promise<void>((resolve) => queueMicrotask(resolve));
          }
        } catch (error) {
          lifetime?.finish('error');
          queue.length = 0;
          void inner.close();
          throw error;
        }
      },

      async return(value?: any) {
        lifetime?.finish('cancel');
        queue.length = 0;
        await inner.close();
        try {
          await source.return?.(value);
        } catch {}
        return DONE;
      },

      async throw(err: any) {
        lifetime?.finish('error');
        await inner.close();
        const error = normalizeError(err);
        queue.length = 0;
        try {
          await source.return?.();
        } catch {}
        throw error;
      }
    };

    return iterator;
  });
