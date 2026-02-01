const ITERATOR_EMISSION_STAMP = new WeakMap<AsyncIterator<any>, number>();

let lastEmissionStamp = 0;
let currentEmissionStamp: number | null = null;


const hasPerfNow =
  typeof globalThis !== "undefined" &&
  typeof (globalThis as any).performance !== "undefined" &&
  typeof (globalThis as any).performance.now === "function";

const perfNow = hasPerfNow ? (globalThis as any).performance.now.bind((globalThis as any).performance) : null;

const getMicros = perfNow
  ? () => Math.floor(perfNow() * 1000)
  : () => Date.now() * 1000;

/**
 * Generate and return the next unique emission stamp (monotonically increasing number).
 * Used to order emissions in streams and subjects.
 * @returns {number} The next emission stamp.
 */
export function nextEmissionStamp(): number {
  // Use a monotonic performance counter when available for higher-resolution
  // and to avoid clock skew issues with Date.now().
  const micros = getMicros();

  if (micros > lastEmissionStamp) {
    lastEmissionStamp = micros;
  } else {
    lastEmissionStamp += 1;
  }

  return lastEmissionStamp;
}

/**
 * Get the current emission stamp from the context, if any.
 * Returns null if not inside an emission context.
 * @returns {number | null} The current emission stamp or null.
 */
export function getCurrentEmissionStamp(): number | null {
  return currentEmissionStamp;
}

/**
 * Run a function within a specific emission stamp context.
 * Temporarily sets the emission stamp for the duration of the function.
 * @template T
 * @param {number} stamp - The emission stamp to set.
 * @param {() => T} fn - The function to execute.
 * @returns {T} The result of the function.
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
 * Set the emission stamp on an async iterator for tracking emission order.
 * @param {AsyncIterator<any>} iterator - The iterator to tag.
 * @param {number} stamp - The emission stamp to set.
 */
export function setIteratorEmissionStamp(iterator: AsyncIterator<any>, stamp: number): void {
  ITERATOR_EMISSION_STAMP.set(iterator, stamp);
}

/**
 * Get the emission stamp from an async iterator, if present.
 * @param {AsyncIterator<any>} iterator - The iterator to inspect.
 * @returns {number | undefined} The emission stamp, if set.
 */
export function getIteratorEmissionStamp(iterator: AsyncIterator<any>): number | undefined {
  return ITERATOR_EMISSION_STAMP.get(iterator);
}


