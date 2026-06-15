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
 * app.count.next(5);
 * console.log(app.doubled.value); // 10
 * app.dispose();
 * ```
 */

export { atom, derived, discrete, flow, iterate } from './atom';
export type { Atom, AtomBase, AtomOptions } from './atom';

export { globalScope, scope } from './scope';
export type { Scope, ScopeMode, ScopeOptions } from './scope';

