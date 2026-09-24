import type {
  SxBindingPlan,
} from './binding-plan';
import {
  emitBindingTable,
} from './emit-binding-table';

export interface SxCompiledViewPlan {
  readonly nodes: readonly string[];
  readonly bindings: SxBindingPlan;
}

/**
 * Emits the direct binding setup body for a parsed template.
 *
 * The caller is responsible for supplying the concrete DOM node references
 * named by `view.nodes`. This keeps DOM creation and binding installation
 * separate and makes the contract usable from different Angular build hooks.
 */
export function emitCompiledViewBindings(
  view: SxCompiledViewPlan,
): string {
  return emitBindingTable(view.bindings);
}
