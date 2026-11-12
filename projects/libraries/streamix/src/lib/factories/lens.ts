import {
  derived,
  NO_INITIAL_VALUE,
  type Readable,
  type SyncOnly,
  type Writable
} from '../atoms/atom';

export type LensPath = PropertyKey | readonly PropertyKey[];

/** A writable, focused view of a source atom. */
export interface Lens<T> extends Readable<T> {
  set(value: T): void;
  next(value: T): void;
}

type OptionalAt<T> = undefined extends T ? undefined : never;

/** Infers the selected value for a property or a literal tuple path. */
export type LensValue<T, P> =
  P extends readonly [infer Key, ...infer Rest]
    ? Key extends keyof NonNullable<T>
      ? LensValue<NonNullable<T>[Key], Rest> | OptionalAt<T>
      : unknown
    : P extends readonly []
      ? T
      : P extends keyof NonNullable<T>
        ? NonNullable<T>[P] | OptionalAt<T>
        : unknown;

function keysOf(path: LensPath): readonly PropertyKey[] {
  const keys = Array.isArray(path) ? [...path] : [path as PropertyKey];
  if (keys.length === 0) throw new TypeError('lens: a non-empty path is required');
  for (const key of keys) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError(`lens: unsafe path key "${String(key)}"`);
    }
  }
  return keys;
}

function readPath(root: unknown, keys: readonly PropertyKey[]): unknown {
  let value: any = root;
  for (const key of keys) value = value?.[key];
  return value;
}

/**
 * Copies only containers along the edited path. Unaffected branches retain
 * their identities; frozen source snapshots are never modified.
 *
 * A write through a missing intermediate container is an error rather than
 * silently inventing an object or array. A missing final property is allowed.
 */
function writePath(root: unknown, keys: readonly PropertyKey[], value: unknown, index = 0): unknown {
  if (root === null || typeof root !== 'object') {
    throw new TypeError(`lens: cannot write through a non-object at path index ${index}`);
  }

  const prototype = Object.getPrototypeOf(root);
  if (!Array.isArray(root) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('lens: writing requires plain objects or arrays along the path');
  }

  const key = keys[index];
  const previous = (root as any)[key];
  const updated = index === keys.length - 1
    ? value
    : writePath(previous, keys, value, index + 1);

  if (Object.is(previous, updated)) return root;

  const copy: any = Array.isArray(root)
    ? root.slice()
    : Object.assign(Object.create(prototype), root);
  copy[key] = updated;
  return copy;
}

/**
 * Creates a focused reactive atom for a property or nested path.
 *
 * Reads are synchronous and dependency-tracked. The focused atom emits its
 * current value and subsequent changes, comparing selections with Object.is.
 * Unrelated source updates do not emit a new selected value. Missing paths
 * read as undefined; an uninitialized source remains unavailable.
 *
 * A writable source produces a writable lens. set()/next() write through to
 * the source using immutable path copying. A read-only source produces a
 * read-only atom. Disposing the lens never disposes its source.
 *
 * @example
 * ```ts
 * const profile = atom({ name: 'Alex', address: { city: 'Kyiv' } });
 * const name = lens(profile, 'name');
 * const city = lens(profile, ['address', 'city']);
 * console.log(city.value); // 'Kyiv'
 * city.set('Lviv');
 * console.log(profile.value.address.city); // 'Lviv'
 * ```
 */
export function lens<T extends object, const P extends LensPath>(
  source: Writable<T>, path: P,
): Lens<LensValue<T, P>>;
/** Composing writable lenses keeps the write-through API. */
export function lens<T extends object, const P extends LensPath>(
  source: Lens<T>, path: P,
): Lens<LensValue<T, P>>;
export function lens<T extends object, const P extends LensPath>(
  source: Readable<T>, path: P,
): Readable<LensValue<T, P>>;
export function lens<T extends object, const P extends LensPath>(
  source: Readable<T>, path: P,
): Readable<LensValue<T, P>> {
  const keys = keysOf(path);
  type V = LensValue<T, P>;

  // The native derived node owns dependency tracking, synchronous reads,
  // subscriptions, error propagation, disposal and async iteration. The cast
  // narrows the unknown selected value to derived()'s sync-only contract.
  const focused = derived<V>($ => readPath($(source), keys) as SyncOnly<V>);

  if (typeof (source as Partial<Writable<T>>).set === 'function') {
    const set = (value: V): void => {
      if (focused.disposed) throw new Error('lens: lens has been disposed');
      const current = source.value;
      if ((current as unknown) === NO_INITIAL_VALUE) {
        throw new Error('lens: cannot write before the source has a value');
      }
      const updated = writePath(current, keys, value) as T;
      if (updated !== current) (source as Writable<T>).set(updated);
    };

    // Extend the actual registered atom rather than returning a detached
    // façade. The result remains a native atom in Streamix's runtime graph.
    return Object.assign(focused, { set, next: set });
  }

  return focused;
}
