export interface SxValueStructuralPlan {
  readonly kind: 'value';
  readonly block: number;
  readonly source: string;
  readonly alias?: string;
  readonly template: string;
}

export interface SxCollectionStructuralPlan {
  readonly kind: 'collection';
  readonly block: number;
  readonly source: string;
  readonly item: string;
  readonly trackBy?: string;
  readonly template: string;
}

export type SxStructuralPlanEntry =
  | SxValueStructuralPlan
  | SxCollectionStructuralPlan;

export interface SxStructuralPlan {
  readonly blocks: readonly SxStructuralPlanEntry[];
}
