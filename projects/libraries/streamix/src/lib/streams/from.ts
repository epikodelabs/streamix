import { flow, type AtomBase } from "../atoms/atom";
import { toAsyncIterable, type StreamInput } from "./pipe";

/**
 * Creates an atom from an asynchronous or synchronous iterable.
 *
 * This operator is a powerful way to convert any source that can be iterated
 * over (such as arrays, strings, `Map`, `Set`, `AsyncGenerator`, etc.) into
 * a reactive atom. The atom's value is updated with each value from the source
 * before completing.
 *
 * @template T The type of the values in the iterable.
 * @param source The iterable source to convert into an atom.
 * @returns {AtomBase<T>} A new atom that emits each value from the source.
 */
export function from<T = any>(source: StreamInput<T>): AtomBase<T> {
  return flow<T>(async function* () {
    yield* toAsyncIterable(source);
  });
}
