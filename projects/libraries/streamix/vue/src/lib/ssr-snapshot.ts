import type {
  DependencySource,
  Writable,
} from '@epikodelabs/streamix';

/**
 * Serializes named atom values for a server-rendered document and applies a
 * validated payload back into writable atoms before client hydration. The
 * payload is a versioned JSON document embedded in a non-executable script
 * element, so the server render and the client hydration observe the exact
 * same values without duplicating state into Vue's own stores.
 */

export type AtomSnapshot = Record<string, unknown>;

export interface AtomSnapshotPayload {
  readonly version: 1;
  readonly atoms: AtomSnapshot;
}

/** Captures named atom values for an SSR payload. */
export function createAtomSnapshot(
  sources: Record<string, DependencySource<unknown>>,
): AtomSnapshot {
  return Object.fromEntries(
    Object.entries(sources).map(([name, source]) => [name, source.value]),
  );
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

/** Creates a JSON-safe, versioned SSR payload from named atom snapshots. */
export function serializeAtomSnapshot(
  sources: Record<string, DependencySource<unknown>>,
): string {
  const payload: AtomSnapshotPayload = {
    version: 1,
    atoms: createAtomSnapshot(sources),
  };
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

/** Parses and validates a versioned SSR payload before client hydration. */
export function parseAtomSnapshot(serialized: string): AtomSnapshotPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Invalid Streamix atom snapshot JSON');
  }

  if (
    typeof parsed !== 'object' || parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { atoms?: unknown }).atoms !== 'object' ||
    (parsed as { atoms?: unknown }).atoms === null ||
    Array.isArray((parsed as { atoms: unknown }).atoms)
  ) {
    throw new Error('Invalid Streamix atom snapshot payload');
  }

  return parsed as AtomSnapshotPayload;
}

/** Validates matching server/client atom keys, then applies the payload. */
export function hydrateAtomPayload(
  targets: Record<string, Writable<unknown>>,
  payload: AtomSnapshotPayload,
): void {
  const expected = Object.keys(targets).sort();
  const received = Object.keys(payload.atoms).sort();

  if (
    expected.length !== received.length ||
    expected.some((name, index) => name !== received[index])
  ) {
    throw new Error(
      `Atom snapshot keys do not match hydration targets (expected: ${expected.join(', ')}; received: ${received.join(', ')})`,
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
