const ITERATOR_EMISSION_STAMP = new WeakMap<AsyncIterator<any>, number>();

let lastEmissionStamp = 0;
let currentEmissionStamp: number | null = null;

/**
 * Generates a monotonically increasing timestamp/ID for a new emission.
 *
 * This ensures strict ordering of events even if they occur within the same
 * millisecond, which is crucial for glitch-free reactive propagation.
 *
 * @returns {number} A unique number representing the current emission stamp.
 */
export function nextEmissionStamp(): number {
  const now = Date.now();
  if (now > lastEmissionStamp) {
    lastEmissionStamp = now;
  } else {
    lastEmissionStamp++;
  }
  return lastEmissionStamp;
}

/**
 * Retrieves the currently active emission stamp, if any.
 *
 * This is used to check if code is running inside a reactive propagation loop
 * (i.e., inside a `withEmissionStamp` block).
 *
 * @returns {number | null} The current emission stamp or `null` if none is active.
 */
export function getCurrentEmissionStamp(): number | null {
  return currentEmissionStamp;
}

/**
 * Executes a function within the context of a specific emission stamp.
 *
 * This function sets the global `currentEmissionStamp` for the duration of the
 * callback, allowing deep call stacks to share the same "logical time" of the emission.
 *
 * @template T The return type of the function.
 * @param {number} stamp The emission stamp to set active.
 * @param {() => T} fn The function to execute.
 * @returns {T} The result of the function execution.
 */
export function withEmissionStamp<T>(stamp: number, fn: () => T): T {
  const prev = currentEmissionStamp;
  currentEmissionStamp = stamp;
  try {
    return fn();
  } finally {
    currentEmissionStamp = prev;
  }
}

/**
 * Associates a specific emission stamp with an iterator.
 *
 * This is used to track the "time" of the last value yielded by an iterator,
 * which helps in synchronization when merging or combining streams.
 *
 * @param {AsyncIterator<any>} iterator The iterator to tag.
 * @param {number} stamp The emission stamp to associate.
 */
export function setIteratorEmissionStamp(iterator: AsyncIterator<any>, stamp: number): void {
  ITERATOR_EMISSION_STAMP.set(iterator, stamp);
}

/**
 * Retrieves the emission stamp associated with an iterator.
 *
 * @param {AsyncIterator<any>} iterator The iterator to check.
 * @returns {number | undefined} The associated emission stamp, or undefined if not set.
 */
export function getIteratorEmissionStamp(iterator: AsyncIterator<any>): number | undefined {
  return ITERATOR_EMISSION_STAMP.get(iterator);
}

