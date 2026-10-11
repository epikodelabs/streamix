import type {
  Atom,
  DependencySource,
  Writable,
} from '@epikodelabs/streamix';

/** Reads an atom explicitly, without composable involvement. */
export function read<T>(source: DependencySource<T>): T {
  return source.value;
}

/** Writes an atom explicitly, without composable involvement. */
export function write<T>(source: Writable<T>, value: T): void {
  source.next(value);
}

/** Marks an atom reference intended to cross a component boundary. */
export function atomRef<T extends Atom<any>>(source: T): T {
  return source;
}
