export type SxBindingKind =
  | 'text'
  | 'property'
  | 'attribute'
  | 'class'
  | 'style';

export interface SxBindingPlanEntry {
  readonly slot: number;
  readonly kind: SxBindingKind;
  readonly node: string;
  readonly source: string;
  readonly name?: string;
}

/**
 * Compiler-neutral binding plan.
 *
 * Angular template parsing can feed this representation before the final
 * TypeScript code-emission step.
 */
export interface SxBindingPlan {
  readonly size: number;
  readonly bindings: readonly SxBindingPlanEntry[];
}

export function createBindingPlan(
  bindings: readonly Omit<SxBindingPlanEntry, 'slot'>[],
): SxBindingPlan {
  return {
    size: bindings.length,
    bindings: bindings.map((binding, slot) => ({
      ...binding,
      slot,
    })),
  };
}
