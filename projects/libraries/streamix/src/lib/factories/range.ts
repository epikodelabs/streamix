import { flow, type Atom } from '../atoms/atom';

/**
 * Creates an atom that emits a sequence of numbers, starting from `start`,
 * incrementing by `step`, and emitting a total of `count` values.
 *
 * This operator is a powerful way to generate a numerical sequence in a
 * reactive context. It's similar to a standard `for` loop but produces
 * values as an atom.
 *
 * @param start - The first number to emit in the sequence.
 * @param count - The total number of values to emit. Must be a non-negative number.
 * @param step - The amount to increment or decrement the value in each step.
 * @returns {Atom<number >} An atom that emits a sequence of numbers.
 */
export function range(start: number, count: number, step: number = 1): Atom<number > {
  return flow<number >(async function* () {
    for (let i = 0; i < count; i++) {
      yield start + i * step;
    }
  });
}
