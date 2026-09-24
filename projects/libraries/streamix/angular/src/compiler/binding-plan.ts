export type SxBindingKind =
  | 'text'
  | 'property'
  | 'attribute'
  | 'class'
  | 'style';

/** Offsets of an sx attribute within the original template source. */
export interface SxSourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface SxBindingPlanEntry {
  readonly slot: number;
  readonly kind: SxBindingKind;
  readonly node: string;
  readonly source: string;
  readonly name?: string;
  /** Present when the entry was extracted from a parsed template. */
  readonly span?: SxSourceSpan;
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
