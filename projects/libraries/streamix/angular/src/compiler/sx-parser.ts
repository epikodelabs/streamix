import type {
  SxCollectionStructuralPlan,
  SxStructuralPlanEntry,
  SxValueStructuralPlan,
} from './structural-plan';

export interface ParsedSxExpression {
  readonly kind: 'value' | 'collection';
  readonly source: string;
  readonly alias?: string;
  readonly item?: string;
  readonly trackBy?: string;
}

export function parseSxExpression(
  expression: string,
): ParsedSxExpression {
  const collection =
    /^\s*let\s+([A-Za-z_$][\w$]*)\s+of\s+([^;]+?)(?:\s*;\s*trackBy\s*:\s*(.+?))?\s*$/.exec(
      expression,
    );

  if (collection) {
    return {
      kind: 'collection',
      item: collection[1],
      source: collection[2].trim(),
      trackBy: collection[3]?.trim(),
    };
  }

  const value =
    /^\s*(.+?)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
      expression,
    );

  if (!value || !value[1]?.trim()) {
    throw new Error(
      `Invalid sx expression: ${JSON.stringify(expression)}.`,
    );
  }

  return {
    kind: 'value',
    source: value[1].trim(),
    alias: value[2],
  };
}

export function createSxStructuralPlanEntry(
  block: number,
  expression: string,
  template: string,
): SxStructuralPlanEntry {
  const parsed = parseSxExpression(expression);

  if (parsed.kind === 'collection') {
    return {
      kind: 'collection',
      block,
      source: parsed.source,
      item: parsed.item!,
      trackBy: parsed.trackBy,
      template,
    } satisfies SxCollectionStructuralPlan;
  }

  return {
    kind: 'value',
    block,
    source: parsed.source,
    alias: parsed.alias,
    template,
  } satisfies SxValueStructuralPlan;
}
