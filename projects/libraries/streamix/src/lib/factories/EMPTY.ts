import { flow, type Atom } from '../atoms/atom';

/**
 * Creates an empty atom that emits no values and completes immediately.
 *
 * @template T The type of the atom's values (will never be emitted).
 * @returns {Atom<T>} An empty atom.
 */
export const empty = <T = any>(): Atom<T> => {
  return flow<T>(async function* () {});
};

/**
 * A singleton instance of an empty atom.
 *
 * This constant provides a reusable, empty atom that immediately completes
 * upon subscription without emitting any values. It is useful in stream
 * compositions as a placeholder or to represent a sequence with no elements.
 */
export const EMPTY = empty();
