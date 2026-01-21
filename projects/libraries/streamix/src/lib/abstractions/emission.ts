const ITERATOR_EMISSION_STAMP = new WeakMap<AsyncIterator<any>, number>();

let lastEmissionStamp = 0;
let currentEmissionStamp: number | null = null;

export function nextEmissionStamp(): number {
  const now = Date.now();
  if (now > lastEmissionStamp) {
    lastEmissionStamp = now;
  } else {
    lastEmissionStamp++;
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

