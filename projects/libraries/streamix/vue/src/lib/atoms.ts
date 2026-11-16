import type {
  Readable,
  DependencySource,
  Writable,
} from '@epikodelabs/streamix';
import { recordStreamixDevtoolsEvent } from './devtools';
import { NO_INITIAL_VALUE } from '@epikodelabs/streamix';

/** Reads an atom explicitly, without composable involvement. */
export function read<T>(source: DependencySource<T>): T {
  recordStreamixDevtoolsEvent({ type: 'read', source: 'explicit atom read' });
  // Delivery contract (React parity): failed reads throw to the caller,
  // pending reads are undefined, and completed sources keep the core's own
  // disposed-read semantics.
  if ((source as { disposed?: unknown }).disposed === true) {
    const storedError = (source as { error?: unknown }).error;
    if (storedError !== undefined) throw storedError;
    const disposedValue = source.value;
    return disposedValue === NO_INITIAL_VALUE ? undefined as T : disposedValue;
  }
  try {
    const value = source.value;
    return value === NO_INITIAL_VALUE ? undefined as T : value;
  } catch (error) {
    throw (source as { error?: unknown }).error ?? error;
  }
}

/** Writes an atom explicitly, without composable involvement. */
export function write<T>(source: Writable<T>, value: T): void {
  recordStreamixDevtoolsEvent({ type: 'write', source: 'explicit atom write' });
  source.next(value);
}

/** Marks an atom reference intended to cross a component boundary. */
export function atomRef<T extends Readable<any>>(source: T): T {
  return source;
}
