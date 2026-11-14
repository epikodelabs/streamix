import type { Readable } from '../atoms/atom';
import { timer } from './timer';

/**
 * Creates an atom that emits incremental numbers starting from 0 at a regular
 * interval.
 *
 * This operator is a shorthand for `timer(intervalMs, intervalMs)`: the first
 * value (0) is emitted after one full period, then a new value every
 * `intervalMs`. This matches RxJS `interval` and `setInterval`.
 *
 * @param intervalMs The time in milliseconds between each emission.
 * @returns {Readable<number>} An atom that emits incrementing numbers (0, 1, 2, ...).
 */
export function interval(intervalMs: number): Readable<number> {
  return timer(intervalMs, intervalMs);
}
