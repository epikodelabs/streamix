import type { MaybePromise } from '../abstractions';
import type { AtomBase } from '../atoms/atom';
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
 * @param intervalMs The time in milliseconds between each emission.
 * @returns {AtomBase<number | undefined>} An atom that emits incrementing numbers (0, 1, 2, ...).
 */
export function interval(intervalMs: MaybePromise<number>): AtomBase<number | undefined> {
  return timer(0, intervalMs);
}
