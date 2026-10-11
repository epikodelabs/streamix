import type {
  Atom,
  DependencySource,
  Writable,
} from '@epikodelabs/streamix';
import { recordStreamixDevtoolsEvent } from './devtools';

/** Reads an atom explicitly, without composable involvement. */
export function read<T>(source: DependencySource<T>): T {
  recordStreamixDevtoolsEvent({ type: 'read', source: 'explicit atom read' });
  return source.value;
}

/** Writes an atom explicitly, without composable involvement. */
export function write<T>(source: Writable<T>, value: T): void {
  recordStreamixDevtoolsEvent({ type: 'write', source: 'explicit atom write' });
  source.next(value);
}

/** Marks an atom reference intended to cross a component boundary. */
export function atomRef<T extends Atom<any>>(source: T): T {
  return source;
}
