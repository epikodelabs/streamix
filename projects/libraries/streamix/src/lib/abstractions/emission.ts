const ITERATOR_EMISSION_STAMP = new WeakMap<AsyncIterator<any>, number>();

let lastEmissionStamp = 0;
let currentEmissionStamp: number | null = null;

export function nextEmissionStamp(): number {
  // Use a monotonic performance counter when available for higher-resolution
  // and to avoid clock skew issues with Date.now().
  const hasPerfNow =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as any).performance !== "undefined" &&
    typeof (globalThis as any).performance.now === "function";

  const micros = hasPerfNow
    ? Math.floor((globalThis as any).performance.now() * 1000)
    : Date.now() * 1000;

  if (micros > lastEmissionStamp) {
    lastEmissionStamp = micros;
  } else {
    lastEmissionStamp += 1;
  }

  return lastEmissionStamp;
}

export function getCurrentEmissionStamp(): number | null {
  return currentEmissionStamp;
}

export function withEmissionStamp<T>(stamp: number, fn: () => T): T {
  const prev = currentEmissionStamp;
  currentEmissionStamp = stamp;
  try {
    return fn();
  } finally {
    currentEmissionStamp = prev;
  }
}

export function setIteratorEmissionStamp(iterator: AsyncIterator<any>, stamp: number): void {
  ITERATOR_EMISSION_STAMP.set(iterator, stamp);
}

export function getIteratorEmissionStamp(iterator: AsyncIterator<any>): number | undefined {
  return ITERATOR_EMISSION_STAMP.get(iterator);
}

