import { iterate, type Atom } from "../atoms";

function isAtomLike(value: unknown): value is Atom<any> {
  return value != null && (value as any).type === "atom";
}

/**
 * Returns a promise that resolves with the last emitted value from an `AtomBase` or atom.
 *
 * - **Successful resolution:** The promise resolves with the last value
 *   emitted by the source, after the source has completed.
 * - **Rejection on error:** If the source emits an error, the promise is rejected.
 * - **Rejection on no value:** If the source completes without emitting any
 *   values, the promise is rejected with a specific error message.
 *
 * @template T The type of the value expected from the source.
 * @param source The source stream or atom to listen to for the final value.
 * @returns A promise that resolves with the last value from the source or rejects on completion without a value or on error.
 */
export function lastValueFrom<T = any>(source: Atom<T> | AsyncIterable<T>): Promise<T> {
  const iterator = isAtomLike(source)
    ? iterate(source)[Symbol.asyncIterator]()
    : (source as AsyncIterable<T>)[Symbol.asyncIterator]();

  return (async () => {
    let hasValue = false;
    let lastValue!: T;

    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        hasValue = true;
        lastValue = next.value;
      }

      if (!hasValue) {
        throw new Error("Source completed without emitting a value");
      }

      return lastValue;
    } finally {
      try {
        await iterator.return?.();
      } catch {
      }
    }
  })();
}
