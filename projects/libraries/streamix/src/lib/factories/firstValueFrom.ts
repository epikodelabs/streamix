import { iterate, type Atom } from "../atoms";

function isAtomLike(value: unknown): value is Atom<any> {
  return value != null && (value as any).type === "atom";
}

/**
 * Returns a promise that resolves with the first emitted value from an `AtomBase` or atom.
 *
 * - If the source emits a value, the promise resolves with that value.
 * - If the source emits an error, the promise rejects with that error.
 * - If the source completes without ever emitting a value, the promise rejects with an `Error`.
 *
 * @template T The type of the value that the promise will resolve with.
 * @param source The source stream or atom to listen to.
 * @returns A promise that resolves with the first value from the source or rejects on error or completion without a value.
 */
export function firstValueFrom<T = any>(source: Atom<T> | AsyncIterable<T>): Promise<T> {
  const iterator = isAtomLike(source)
    ? iterate(source)[Symbol.asyncIterator]()
    : (source as AsyncIterable<T>)[Symbol.asyncIterator]();

  return (async () => {
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) {
          throw new Error("Source completed without emitting a value");
        }
        return result.value;
      }
    } finally {
      try {
        await iterator.return?.();
      } catch {
      }
    }
  })();
}
