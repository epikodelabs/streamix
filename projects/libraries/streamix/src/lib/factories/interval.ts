import type { Atom } from '../atoms/atom';
import { timer } from './timer';

/**
 * Creates an atom that emits incremental numbers starting from 0 at a regular
 * interval.
 *
 * This operator is a shorthand for `timer(0, intervalMs)`, useful for
 * creating a simple, repeating sequence of numbers. The atom emits a new
 * value every `intervalMs` milliseconds. It is analogous to `setInterval` but
 * as an asynchronous atom.
 *
 * Note: because this is `timer(0, …)`, the first value (0) is emitted
 * immediately rather than after one period — unlike RxJS `interval`, whose
 * first tick arrives after `intervalMs`.
 *
 * @param intervalMs The time in milliseconds between each emission.
 * @returns {Atom<number >} An atom that emits incrementing numbers (0, 1, 2, ...).
 */
export function interval(intervalMs: number): Atom<number > {
  return timer(0, intervalMs);
}
