import { isPromiseLike, type MaybePromise } from '../atoms';
import { flow, type AtomBase } from '../atoms/atom';

/**
 * Creates an atom that emits a single value and then completes.
 *
 * This operator is useful for scenarios where you need to treat a static,
 * single value as an atom. It immediately yields the provided `value`
 * and then signals completion, which is a common pattern for creating a
 * "hot" atom from a predefined value.
 *
 * @template T The type of the value to be emitted.
 * @param value The single value to emit.
 * @returns {AtomBase<T>} A new atom that emits the value and then completes.
 */
export function of<T = any>(value: MaybePromise<T>): AtomBase<T> {
  return flow<T>(async function* () {
    yield isPromiseLike(value) ? await value : value;
  });
}
