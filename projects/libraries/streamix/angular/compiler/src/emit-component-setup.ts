import type {
  ParsedSxTemplate,
  SxElementPath,
} from './angular-template-parser';
import type {
  SxCompiledBlockTemplate,
} from './block-template-compiler';
import {
  indent,
} from './codegen';
import type {
  SxLoweredBlock,
} from './structural-lowering';
import {
  rewriteSxTextExpression,
} from './text-expression';

function source(entrySource: string): string {
  return `ctx.${entrySource}`;
}

function sources(dependencies: readonly string[] | undefined): string {
  return `[${(dependencies ?? []).map(source).join(', ')}]`;
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
  blocks: readonly SxLoweredBlock[] = [],
): string {
  // Parameters are named for their use: generated setup may be inlined into
  // the component module, where `noUnusedParameters` applies and there is no
  // ts-nocheck escape hatch.
  const hasBlocks = blocks.length > 0;
  const usesHost = hasBlocks || parsed.plan.bindings.length > 0;
  // Structural blocks read their sources and factories from `ctx` too.
  const usesCtx = hasBlocks || parsed.plan.bindings.length > 0;

  const parameters = [
    `${usesHost ? 'host' : '_host'}: Element`,
    `${usesCtx ? 'ctx' : '_ctx'}: any`,
  ];

  if (hasBlocks) {
    // The runtime reports whether this setup is running during server
    // rendering, where block markers must stay in place for hydration.
    parameters.push('server = false');
  }

  const lines: string[] = [
    `function ${functionName}(`,
    ...parameters.map(parameter => `  ${parameter},`),
    `) {`,
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
        `  const ${entry.node} = ${elementPathExpression(path)} as HTMLElement;`,
      );
    }

    switch (entry.kind) {
      case 'text':
        lines.push(
          `  ɵsxText(table, ${entry.slot}, ${entry.node}, ${source(entry.source)});`,
        );
        break;
      case 'text-node':
        lines.push(
          `  ɵsxTextNode(table, ${entry.slot}, ${entry.node}, ${source(entry.source)});`,
        );
        break;
      case 'text-expression':
        lines.push(
          `  ɵsxTextExpression(table, ${entry.slot}, ${entry.node}, ${sources(entry.dependencies)}, () => ${rewriteSxTextExpression(entry.source)});`,
        );
        break;
      case 'text-expression-node':
        lines.push(
          `  ɵsxTextExpressionNode(table, ${entry.slot}, ${entry.node}, ${sources(entry.dependencies)}, () => ${rewriteSxTextExpression(entry.source)});`,
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
      case 'class-map':
        lines.push(
          `  ɵsxClassMap(table, ${entry.slot}, ${entry.node}, ${source(entry.source)});`,
        );
        break;
      case 'style':
        lines.push(
          `  ɵsxStyle(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${source(entry.source)});`,
        );
        break;
      case 'style-map':
        lines.push(
          `  ɵsxStyleMap(table, ${entry.slot}, ${entry.node}, ${source(entry.source)});`,
        );
        break;
    }
  }

  if (blocks.length > 0) {
    lines.push(`  const doc = host.ownerDocument!;`);
    const structural = emitStructuralBlocks(parsed, blocks);
    lines.push(...structural.lines);
    lines.push(`  return {`);
    lines.push(`    destroy() {`);
    lines.push(`      table.destroy();`);

    for (const entry of structural.teardown) {
      lines.push(`      ${entry.block}.destroy();`);
      lines.push(`      ɵsxRestoreBlockMarker(${entry.anchor}, ${entry.marker});`);
    }

    lines.push(`    },`);
    lines.push(`  };`);
  } else {
    lines.push('  return table;');
  }

  lines.push('}');
  return lines.join('\n');
}

function emitStructuralBlocks(
  parsed: ParsedSxTemplate,
  blocks: readonly SxLoweredBlock[],
): {
  readonly lines: readonly string[];
  readonly teardown: readonly {
    readonly block: string;
    readonly anchor: string;
    readonly marker: string;
  }[];
} {
  const lines: string[] = [];
  const teardown: {
    block: string;
    anchor: string;
    marker: string;
  }[] = [];

  // Resolve every marker before any anchor replaces one: replacement removes
  // an element, which shifts the element indices of all later siblings.
  blocks.forEach((block, index) => {
    const nodeId = parsed.markers[block.marker];
    const path = nodeId ? parsed.nodePaths[nodeId] : undefined;

    if (!path) {
      throw new Error(`Missing static DOM path for structural marker ${block.marker}.`);
    }

    lines.push(`  const marker${index} = ${elementPathExpression(path)} as Element;`);
  });

  blocks.forEach((block, index) => {
    const marker = `marker${index}`;
    const anchor = `anchor${index}`;
    const variable = `sxBlock${index}`;

    lines.push(`  const ${anchor} = ɵsxBlockAnchor(${marker}, ${JSON.stringify(`sx:${index}`)}, server);`);

    if (block.kind === 'conditional') {
      lines.push(`  const ${variable} = ɵcreateSxConditionalBlock(${anchor}, [`);

      for (const branch of block.branches) {
        const source = branch.source ? `ctx.${branch.source}` : 'null';
        const roots = branch.compiled.rootNodes;

        lines.push(`    {`);
        lines.push(`      source: ${source},`);

        if (branch.match !== undefined) {
          lines.push(`      match: ${branch.match},`);
        }

        lines.push(`      factory: () => {`);
        lines.push(indent(branch.compiled.createBody, 8));
        lines.push(...blockBindingLines(branch.compiled, 8));
        lines.push(`        return {`);
        lines.push(`          first: ${roots[0]},`);
        lines.push(`          last: ${roots[roots.length - 1]},`);
        lines.push(`          destroy() {`);
        lines.push(
          branch.compiled.bindings.length > 0
            ? `            blockTable.destroy();`
            : `            // no per-block bindings`,
        );
        lines.push(`          },`);
        lines.push(`        };`);
        lines.push(`      },`);
        lines.push(`    },`);
      }

      lines.push(`  ]);`);
    } else {
      const compiled = block.compiled;
      const roots = compiled.rootNodes;

      lines.push(`  const ${variable} = ɵcreateSxKeyedBlock(`);
      lines.push(`    ${anchor},`);
      lines.push(`    ctx.${block.source},`);
      lines.push(`    {`);
      const contextObject = [
        block.item,
        'index',
        '$index: index',
        'count',
        '$count: count',
        'first: index === 0',
        '$first: index === 0',
        'last: index === count - 1',
        '$last: index === count - 1',
        'even: index % 2 === 0',
        '$even: index % 2 === 0',
        'odd: index % 2 === 1',
        '$odd: index % 2 === 1',
      ].join(', ');

      lines.push(`      create(${block.item}, index, count) {`);
      lines.push(`        const context = { ${contextObject} };`);
      lines.push(indent(compiled.createBody, 8));
      lines.push(...blockBindingLines(compiled, 8));
      lines.push(`        return ɵcreateSxCompiledBlock(`);
      lines.push(`          ${roots[0]},`);
      lines.push(`          ${roots[roots.length - 1]},`);
      lines.push(`          (context) => {`);
      lines.push(indent(compiled.updateBody, 12));
      lines.push(`          },`);
      lines.push(`          context,`);

      if (compiled.bindings.length > 0) {
        lines.push(`          () => {`);
        lines.push(`            blockTable.destroy();`);
        lines.push(`          },`);
      }

      lines.push(`        );`);
      lines.push(`      },`);
      lines.push(`      update(instance, ${block.item}, index, count) {`);
      lines.push(`        instance.update({ ${contextObject} });`);
      lines.push(`      },`);
      lines.push(`    },`);
      lines.push(`    ${block.trackBy},`);

      if (block.empty) {
        const emptyRoots = block.empty.rootNodes;
        lines.push(`    () => {`);
        lines.push(indent(block.empty.createBody, 6));
        lines.push(...blockBindingLines(block.empty, 6));
        lines.push(`      return {`);
        lines.push(`        first: ${emptyRoots[0]},`);
        lines.push(`        last: ${emptyRoots[emptyRoots.length - 1]},`);
        lines.push(`        destroy() {`);

        if (block.empty.bindings.length > 0) {
          lines.push(`          blockTable.destroy();`);
        }

        lines.push(`        },`);
        lines.push(`      };`);
        lines.push(`    },`);
      }

      lines.push(`  );`);
    }

    teardown.push({ block: variable, anchor, marker });
  });

  return { lines, teardown };
}

/**
 * Emits the per-block binding table. Each generated factory is its own
 * function scope, so the table variable is always named `blockTable`.
 */
function blockBindingLines(
  compiled: SxCompiledBlockTemplate,
  spaces: number,
): readonly string[] {
  if (compiled.bindings.length === 0) {
    return [];
  }

  const pad = ' '.repeat(spaces);

  return [
    `${pad}const blockTable = createBindingTable(${compiled.bindings.length});`,
    ...compiled.bindings.map(
      (binding, slot) =>
        // Block bodies build their own DOM, so the binding targets the text
        // node directly instead of Angular's rendered interpolation node.
        `${pad}ɵsxText(blockTable, ${slot}, ${binding.node}, ctx.${binding.source});`,
    ),
  ];
}
