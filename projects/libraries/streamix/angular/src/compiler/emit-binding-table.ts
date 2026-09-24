import type {
  SxBindingPlan,
  SxBindingPlanEntry,
} from './binding-plan';

function quotedName(entry: SxBindingPlanEntry): string {
  if (!entry.name) {
    throw new Error(`Binding ${entry.slot} (${entry.kind}) requires a name.`);
  }

  return JSON.stringify(entry.name);
}

function instructionFor(entry: SxBindingPlanEntry): string {
  switch (entry.kind) {
    case 'text':
      return `ɵsxText(table, ${entry.slot}, ${entry.node}, ${entry.source});`;

    case 'property':
      return `ɵsxProperty(table, ${entry.slot}, ${entry.node}, ${quotedName(entry)}, ${entry.source});`;

    case 'attribute':
      return `ɵsxAttribute(table, ${entry.slot}, ${entry.node}, ${quotedName(entry)}, ${entry.source});`;

    case 'class':
      return `ɵsxClass(table, ${entry.slot}, ${entry.node}, ${quotedName(entry)}, ${entry.source});`;

    case 'style':
      return `ɵsxStyle(table, ${entry.slot}, ${entry.node}, ${quotedName(entry)}, ${entry.source});`;
  }
}

/**
 * Emits the direct-binding-table initialization body for an sx binding plan.
 *
 * The Angular integration layer can insert this body into generated view setup
 * code once template parsing/transform hooks are wired.
 */
export function emitBindingTable(plan: SxBindingPlan): string {
  const lines = [
    `const table = createBindingTable(${plan.size});`,
    ...plan.bindings.map(instructionFor),
  ];

  return lines.join('\n');
}
