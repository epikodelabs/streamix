/**
 * @module atoms
 *
 * Provides reactive atoms, derived values, and scope-based lifecycle management.
 *
 * Atoms are reactive values that can be read, written to, and subscribed to.
 * They participate in automatic dependency tracking and scope-based cleanup.
 *
 * @example
 * ```ts
 * import { atom, derived, scope, flow } from '@streamix/atoms';
 *
 * const app = scope(() => {
 *   const count = atom(0);
 *   const doubled = derived(() => count.value * 2);
 *   return { count, doubled };
 * });
 *
 * app.count.set(5);
 * console.log(app.doubled.value); // 10
 * app.dispose();
 * ```
 */

export { asyncAtom, atom, derived, flow, iterate } from './atom';
export type { AsyncAtom, AsyncAtomOptions, AtomBase as Atom, Atom as WritableAtom } from './atom';

export { scope } from './scope';
export type { Scope, ScopeOptions } from './scope';

