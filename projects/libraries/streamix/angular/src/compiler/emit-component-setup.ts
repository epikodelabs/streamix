import type {
  ParsedSxTemplate,
  SxElementPath,
} from './angular-template-parser';

function source(entrySource: string): string {
  return `ctx.${entrySource}`;
}

function elementPathExpression(path: SxElementPath): string {
  if (path.length === 0) {
    return 'host';
  }

  let expression = 'host';
  for (const index of path) {
    expression += `.children[${index}]`;
  }

  return expression;
}

export function emitComponentSetup(
  parsed: ParsedSxTemplate,
  functionName = 'ɵsetupSxBindings',
): string {
  const lines: string[] = [
    `export function ${functionName}(host: Element, ctx: any) {`,
    `  const table = createBindingTable(${parsed.plan.size});`,
  ];

  const declared = new Set<string>();

  for (const entry of parsed.plan.bindings) {
    if (!declared.has(entry.node)) {
      declared.add(entry.node);
      const path = parsed.nodePaths[entry.node];

      if (!path) {
        throw new Error(`Missing static DOM path for ${entry.node}.`);
      }

      lines.push(
        `  const ${entry.node} = ${elementPathExpression(path)} as Element;`,
      );
    }

    switch (entry.kind) {
      case 'text':
        lines.push(
          `  ɵsxText(table, ${entry.slot}, ${entry.node}, ${source(entry.source)});`,
        );
        break;
      case 'property':
        lines.push(
          `  ɵsxProperty(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${source(entry.source)});`,
        );
        break;
      case 'attribute':
        lines.push(
          `  ɵsxAttribute(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${source(entry.source)});`,
        );
        break;
      case 'class':
        lines.push(
          `  ɵsxClass(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${source(entry.source)});`,
        );
        break;
      case 'style':
        lines.push(
          `  ɵsxStyle(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${source(entry.source)});`,
        );
        break;
    }
  }

  lines.push('  return table;');
  lines.push('}');
  return lines.join('\n');
}
