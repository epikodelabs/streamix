import { isPromiseLike, isStreamLike, MaybePromise, type Stream } from "../abstractions";
import { iterate, type Atom } from "../atoms";

function isAtomLike(value: unknown): value is Atom<any> {
  return value != null && (value as any).type === "atom";
}

/**
 * Converts various value types into an async iterable.
 *
 * This function normalizes different input types into a consistent async-iterable shape:
 * - Streams are passed through as-is
 * - Atoms are iterated via {@link iterate}
 * - Promises are awaited and their resolved values are processed
 * - Arrays and iterables have each element emitted individually
 * - Single values are emitted as-is
 *
 * @template R The type of values emitted by the resulting iterable.
 * @param value The input value to convert.
 * @returns A {@link Stream<R>} that emits the normalized values.
 */
export function fromAny<R = any>(
  value: Stream<R> | Atom<R> | MaybePromise<R> | Array<R> | Iterable<R> | AsyncIterable<R>
): Stream<R> {
  // Step 1: If it's already a stream, return as-is
  if (isStreamLike<R>(value)) {
    return value;
  }

  // Step 2: Atoms are cold; lift them into a stream-like async iterable.
  if (isAtomLike(value)) {
    return {
      type: "stream",
      name: "fromAny",
      pipe: (() => { throw new Error("fromAny streams do not support pipe"); }) as any,
      subscribe: (() => { throw new Error("fromAny streams do not support subscribe"); }) as any,
      query: (() => { throw new Error("fromAny streams do not support query"); }) as any,
      toArray: (() => { throw new Error("fromAny streams do not support toArray"); }) as any,
      [Symbol.asyncIterator]() {
        return iterate(value)[Symbol.asyncIterator]();
      },
    } as Stream<R>;
  }

  // Step 3: Handle promises, arrays, iterables, and single values in one generator
  return {
    type: "stream",
    name: "fromAny",
    pipe: (() => { throw new Error("fromAny streams do not support pipe"); }) as any,
    subscribe: (() => { throw new Error("fromAny streams do not support subscribe"); }) as any,
    query: (() => { throw new Error("fromAny streams do not support query"); }) as any,
    toArray: (() => { throw new Error("fromAny streams do not support toArray"); }) as any,
    async *[Symbol.asyncIterator]() {
      const resolved = isPromiseLike(value) ? await value : value;
      const candidate = resolved as any;

      // Handle arrays, iterables, and async iterables - emit each element
      if (Array.isArray(resolved)) {
        for (const item of resolved) {
          yield item;
        }
      } else if (candidate != null && typeof candidate[Symbol.asyncIterator] === "function") {
        for await (const item of resolved as AsyncIterable<R>) {
          yield item;
        }
      } else if (candidate != null && typeof candidate[Symbol.iterator] === "function" && typeof resolved !== "string") {
        for (const item of resolved as Iterable<R>) {
          yield item;
        }
      } else {
        // Single value
        yield resolved as R;
      }
    },
  } as Stream<R>;
}
