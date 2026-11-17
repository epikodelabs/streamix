import type {
  DependencySource,
  Writable,
} from '@epikodelabs/streamix';
import { NO_INITIAL_VALUE } from '@epikodelabs/streamix';

/**
 * Serializes named atom values for a server-rendered document and applies a
 * validated payload back into writable atoms before client hydration. The
 * payload is a versioned JSON document embedded in a non-executable script
 * element, so the server render and the client hydration observe the exact
 * same values without duplicating state into Vue's own stores.
 */

export type AtomSnapshot = Record<string, unknown>;

export interface AtomSnapshotPayload {
  /** Version 1 payloads are plain JSON; version 2 tags `undefined` values. */
  readonly version: 1 | 2;
  readonly atoms: AtomSnapshot;
}

/**
 * Reads one source for snapshot capture. Pending, failed, and completed
 * sources report the sentinel so the key is omitted: the sentinel would
 * vanish through JSON.stringify and break hydration key-matching, and a
 * failed read would abort the whole payload. Parity with the React adapter.
 */
function captureSourceValue(source: DependencySource<unknown>): unknown {
  const disposed = (source as { disposed?: unknown }).disposed === true;
  const storedError = (source as { error?: unknown }).error;
  if (disposed && storedError !== undefined) return NO_INITIAL_VALUE;
  if (disposed) return NO_INITIAL_VALUE;
  try {
    return source.value;
  } catch {
    return NO_INITIAL_VALUE;
  }
}

/** Captures named atom values for an SSR payload. */
export function createAtomSnapshot(
  sources: Record<string, DependencySource<unknown>>,
): AtomSnapshot {
  const snapshot: AtomSnapshot = {};
  for (const [name, source] of Object.entries(sources)) {
    const value = captureSourceValue(source);
    if (value === NO_INITIAL_VALUE) continue;
    snapshot[name] = value;
  }
  return snapshot;
}

/** Applies a validated SSR payload to named writable atoms before hydration. */
export function hydrateAtomSnapshot(
  targets: Record<string, Writable<unknown>>,
  snapshot: AtomSnapshot,
): void {
  for (const [name, value] of Object.entries(snapshot)) {
    if (!Object.hasOwn(targets, name)) {
      throw new Error(`Unknown atom snapshot key: ${name}`);
    }

    targets[name].next(value);
  }
}

/** Version-2 wire encoding for one atom: JSON values stay verbatim and
 * `undefined` is tagged so its key survives serialization. */
type EncodedSnapshotAtom = { readonly t: 'json'; readonly v: unknown } | { readonly t: 'undefined' };

/** Rejects values JSON would silently coerce (NaN → null, Date → string, Map
 * → {}) instead of emitting a payload that hydrates different values. */
function assertSnapshotValue(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Atom snapshot is not serializable: ${path} is ${String(value)}`);
    return;
  }
  if (value === undefined) throw new Error(`Atom snapshot is not serializable: ${path} contains undefined; only a top-level atom value may be undefined`);
  if (typeof value === 'bigint') throw new Error(`Atom snapshot is not serializable: ${path} is a bigint`);
  if (typeof value === 'symbol' || typeof value === 'function') throw new Error(`Atom snapshot is not serializable: ${path} is a ${typeof value}`);
  if (ancestors.has(value)) throw new Error(`Atom snapshot is not serializable: ${path} contains a circular reference`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Atom snapshot is not serializable: ${path} is not a plain object or array`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) assertSnapshotValue(value[index], `${path}[${index}]`, ancestors);
  } else {
    for (const [key, item] of Object.entries(value)) assertSnapshotValue(item, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function encodeSnapshotValue(name: string, value: unknown): EncodedSnapshotAtom {
  if (value === undefined) return { t: 'undefined' };
  assertSnapshotValue(value, name, new Set());
  return { t: 'json', v: value };
}

/** Creates a JSON-safe, versioned SSR payload from named atom snapshots.
 * Values that JSON cannot round-trip are rejected before emitting a payload. */
export function serializeAtomSnapshot(
  sources: Record<string, DependencySource<unknown>>,
): string {
  const encoded: Record<string, EncodedSnapshotAtom> = {};
  for (const [name, value] of Object.entries(createAtomSnapshot(sources))) {
    Object.defineProperty(encoded, name, {
      value: encodeSnapshotValue(name, value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const payload = { version: 2 as const, atoms: encoded };
  let json: string | undefined;

  try {
    json = JSON.stringify(payload);
  } catch (error) {
    throw new Error(
      `Atom snapshot is not serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (json === undefined) {
    throw new Error('Atom snapshot is not serializable');
  }

  // Safe for embedding in a non-executable <script type="application/json">.
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** Parses and validates a versioned SSR payload before client hydration.
 * Version 1 (plain JSON) payloads remain readable; version 2 restores tagged
 * `undefined` values. */
export function parseAtomSnapshot(serialized: string): AtomSnapshotPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Invalid Streamix atom snapshot JSON');
  }

  const version = typeof parsed === 'object' && parsed !== null ? (parsed as { version?: unknown }).version : undefined;
  const rawAtoms = typeof parsed === 'object' && parsed !== null ? (parsed as { atoms?: unknown }).atoms : undefined;

  if (
    (version !== 1 && version !== 2) ||
    typeof rawAtoms !== 'object' || rawAtoms === null || Array.isArray(rawAtoms)
  ) {
    throw new Error('Invalid Streamix atom snapshot payload');
  }

  if (version === 1) return { version: 1, atoms: rawAtoms as AtomSnapshot };

  const atoms: AtomSnapshot = {};
  for (const [name, encoded] of Object.entries(rawAtoms)) {
    if (typeof encoded !== 'object' || encoded === null || Array.isArray(encoded)) {
      throw new Error('Invalid Streamix atom snapshot payload');
    }
    const tag = (encoded as { t?: unknown }).t;
    if (tag === 'undefined') {
      Object.defineProperty(atoms, name, { value: undefined, enumerable: true, configurable: true, writable: true });
    } else if (tag === 'json' && Object.prototype.hasOwnProperty.call(encoded, 'v')) {
      Object.defineProperty(atoms, name, { value: (encoded as { v: unknown }).v, enumerable: true, configurable: true, writable: true });
    } else {
      throw new Error('Invalid Streamix atom snapshot payload');
    }
  }
  return { version: 2, atoms };
}

/** Validates matching server/client atom keys, then applies the payload. */
export function hydrateAtomPayload(
  targets: Record<string, Writable<unknown>>,
  payload: AtomSnapshotPayload,
): void {
  // The server omits keys for pending, failed, and completed sources: those
  // targets simply stay pending on the client. Unknown payload keys remain a
  // hard error because they indicate a server/client target mismatch.
  const unknown = Object.keys(payload.atoms)
    .filter(name => !Object.hasOwn(targets, name))
    .sort();

  if (unknown.length > 0) {
    throw new Error(
      `Atom snapshot keys do not match hydration targets (expected: ${Object.keys(targets).sort().join(', ')}; received: ${Object.keys(payload.atoms).sort().join(', ')})`,
    );
  }

  hydrateAtomSnapshot(targets, payload.atoms);
}

/**
 * Produces a non-executable SSR payload element. Render this beside the Vue
 * application on the server, then consume it before mounting on the client.
 */
export function renderAtomSnapshotScript(
  sources: Record<string, DependencySource<unknown>>,
  id = '__streamix_snapshot',
): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error(
      'Streamix snapshot element id must contain only letters, numbers, underscores, or hyphens',
    );
  }

  return `<script id="${id}" type="application/json">${serializeAtomSnapshot(sources)}</script>`;
}

/**
 * Reads, validates, and applies the server snapshot before Vue mounts. The
 * element is removed after a successful handoff so it cannot be applied twice
 * by a later client navigation.
 */
export function hydrateAtomSnapshotFromDocument(
  targets: Record<string, Writable<unknown>>,
  id = '__streamix_snapshot',
  documentRoot: Pick<Document, 'getElementById'> | undefined =
    typeof document === 'undefined' ? undefined : document,
): void {
  if (!documentRoot) {
    throw new Error('Cannot hydrate a Streamix snapshot without a document');
  }

  const element = documentRoot.getElementById(id);

  if (!element) {
    throw new Error(`Missing Streamix snapshot element: #${id}`);
  }

  hydrateAtomPayload(targets, parseAtomSnapshot(element.textContent ?? ''));
  element.remove();
}
