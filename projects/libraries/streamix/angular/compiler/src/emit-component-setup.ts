import type {
  ParsedSxTemplate,
  SxElementPath,
} from './angular-template-parser';
import type { SxBindingPlanEntry } from './binding-plan';
import type {
  SxCompiledBlockBody,
  SxCompiledNestedBlock,
  SxCompiledValue,
} from './block-template-compiler';
import {
  indent,
} from './codegen';
import { KEY_MODIFIER_KEYS } from './event-binding';
import type {
  SxLoweredBlock,
  SxLoweredValue,
} from './structural-lowering';
import {
  rewriteLocalReads,
  rewriteSxTextExpression,
} from './text-expression';

function source(entrySource: string): string {
  return `ctx.${entrySource}`;
}

function sources(dependencies: readonly string[] | undefined): string {
  return `[${(dependencies ?? []).map(source).join(', ')}]`;
}

/**
 * Emits a lowered reactive value: a direct source object, or an expression
 * object carrying its sources and a reader evaluated once per flush.
 */
function loweredValue(
  value: SxLoweredValue | SxCompiledValue,
): string {
  if (value.kind === 'source') {
    return source(value.source);
  }

  if (value.kind === 'local') {
    return (
      `{ sources: [], read: () => ` +
      `${rewriteLocalReads(value.expression, 'currentContext')} }`
    );
  }

  return (
    `{ sources: ${sources(value.dependencies)}, ` +
    `read: () => ${rewriteSxTextExpression(value.expression)} }`
  );
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
  const hasListeners = parsed.plan.bindings.some(
    entry => entry.kind === 'event',
  );
  const usesHost = hasBlocks || parsed.plan.bindings.length > 0;
  // Structural blocks read their sources and factories from `ctx` too.
  const usesCtx = hasBlocks || parsed.plan.bindings.length > 0;

  const parameters = [
    `${usesHost ? 'host' : '_host'}: Element`,
    `${usesCtx ? 'ctx' : '_ctx'}: any`,
  ];

  if (hasBlocks || hasListeners) {
    // The runtime reports whether this setup is running during server
    // rendering, where block markers must stay in place for hydration and
    // event listeners must not be attached.
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
      case 'property-expression':
        lines.push(
          `  ɵsxPropertyExpression(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${sources(entry.dependencies)}, () => ${rewriteSxTextExpression(entry.source)});`,
        );
        break;
      case 'attribute':
        lines.push(
          `  ɵsxAttribute(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${source(entry.source)});`,
        );
        break;
      case 'attribute-expression':
        lines.push(
          `  ɵsxAttributeExpression(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${sources(entry.dependencies)}, () => ${rewriteSxTextExpression(entry.source)});`,
        );
        break;
      case 'class':
        lines.push(
          `  ɵsxClass(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${source(entry.source)});`,
        );
        break;
      case 'class-expression':
        lines.push(
          `  ɵsxClassExpression(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${sources(entry.dependencies)}, () => ${rewriteSxTextExpression(entry.source)});`,
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
      case 'style-expression':
        lines.push(
          `  ɵsxStyleExpression(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${sources(entry.dependencies)}, () => ${rewriteSxTextExpression(entry.source)});`,
        );
        break;
      case 'style-map':
        lines.push(
          `  ɵsxStyleMap(table, ${entry.slot}, ${entry.node}, ${source(entry.source)});`,
        );
        break;
      case 'event':
        lines.push(
          `  ɵsxListener(table, ${entry.slot}, ${entry.node}, ${JSON.stringify(entry.name)}, ${eventHandler(entry)}, ${eventOptions(entry)}, server);`,
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
      // Server rendering creates no block instances, so teardown is optional.
      lines.push(`      ${entry.block}?.destroy();`);
    }

    lines.push(`    },`);
    lines.push(`    ɵrestoreMarkers() {`);

    for (const entry of structural.teardown) {
      // Only a rebind restores the markers: the final teardown must leave
      // Angular's own destroy pass untouched.
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

    // Server rendering keeps the marker empty: the client's template declares
    // an empty marker, so injecting block content inside it makes hydration
    // mismatch and Angular re-render the whole subtree. The compiled view
    // fills the marker right after hydration instead.
    if (block.kind === 'conditional') {
      lines.push(`  const ${variable} = server ? undefined : ɵcreateSxConditionalBlock(${anchor}, [`);

      for (const branch of block.branches) {
        const condition = branch.condition
          ? loweredValue(branch.condition)
          : 'null';
        const roots = branch.compiled.rootNodes;

        lines.push(`    {`);
        lines.push(`      source: ${condition},`);

        if (branch.match !== undefined) {
          lines.push(`      match: ${branch.match},`);
        }

        lines.push(`      factory: () => {`);
        lines.push(indent(branch.compiled.createBody, 8));
        lines.push(...emitBodyContent(branch.compiled, 8));
        lines.push(
          ...bodyInstanceLines(branch.compiled, 8, roots),
        );
        lines.push(`      },`);
        lines.push(`    },`);
      }

      lines.push(`  ]);`);
    } else {
      const compiled = block.compiled;
      const roots = compiled.rootNodes;

      lines.push(`  const ${variable} = server ? undefined : ɵcreateSxKeyedBlock(`);
      lines.push(`    ${anchor},`);
      lines.push(`    ${loweredValue(block.source)},`);
      lines.push(`    {`);
      const contextObject = contextLocals(block.item);

      lines.push(`      create(${block.item}, index, count) {`);
      lines.push(`        let currentContext = { ${contextObject} };`);
      lines.push(indent(compiled.createBody, 8));
      lines.push(...emitBodyContent(compiled, 8, 'currentContext'));
      const rootRange = rootsReference(roots, lines, '        ');
      lines.push(`        return ɵcreateSxCompiledBlock(`);
      lines.push(`          ${rootRange.first},`);
      lines.push(`          ${rootRange.last},`);
      lines.push(`          (context) => {`);
      lines.push(`            currentContext = context;`);
      lines.push(indent(compiled.updateBody, 12));
      lines.push(...nestedRefreshLines(compiled, 12));
      lines.push(`          },`);
      lines.push(`          currentContext,`);

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
        lines.push(...emitBodyContent(block.empty, 6));
        lines.push(
          ...bodyInstanceLines(block.empty, 6, emptyRoots),
        );
        lines.push(`    },`);
      }

      lines.push(`  );`);
    }

    teardown.push({ block: variable, anchor, marker });
  });

  return { lines, teardown };
}

/**
 * The listener body for one event binding: modifier guards, then the authored
 * method call with `$event` bound to the DOM event.
 */
function eventHandler(entry: SxBindingPlanEntry): string {
  const call = entry.handler ??
    `ctx.${entry.source.replace(/\$event\b/g, 'event')}`;

  return eventHandlerBody(call, entry.modifiers);
}

/** The listener arrow for a handler call, with modifier guards up front. */
function eventHandlerBody(
  call: string,
  modifiers: readonly string[] | undefined,
): string {
  const guards: string[] = [];

  if (modifiers?.includes('self')) {
    guards.push(
      'if (event.target !== event.currentTarget) return;',
    );
  }

  if (modifiers?.includes('prevent')) {
    guards.push('event.preventDefault();');
  }

  if (modifiers?.includes('stop')) {
    guards.push('event.stopPropagation();');
  }

  for (const modifier of modifiers ?? []) {
    const key = KEY_MODIFIER_KEYS[modifier];

    if (key) {
      guards.push(`if (event.key !== ${JSON.stringify(key)}) return;`);
    }
  }

  // The parameter is omitted when nothing reads it: generated components are
  // compiled with `noUnusedParameters`.
  const parameter = guards.length > 0 || /(^|[^\w$])event\b/.test(call)
    ? '(event)'
    : '()';

  return `${parameter} => { ${guards.join(' ')}${guards.length > 0 ? ' ' : ''}${call}; }`;
}

/** `addEventListener` options implied by the binding's modifiers. */
function eventOptions(entry: SxBindingPlanEntry): string {
  const modifiers = entry.modifiers ?? [];
  const options: string[] = [];

  if (modifiers.includes('once')) {
    options.push('once: true');
  }

  if (modifiers.includes('capture')) {
    options.push('capture: true');
  }

  return options.length > 0 ? `{ ${options.join(', ')} }` : 'undefined';
}

/**
 * Emits the per-block binding table. Each generated factory is its own
 * function scope, so the table variable is always named `blockTable`.
 */
function blockBindingLines(
  compiled: SxCompiledBlockBody,
  spaces: number,
): readonly string[] {
  if (compiled.bindings.length === 0) {
    return [];
  }

  const pad = ' '.repeat(spaces);

  return [
    `${pad}const blockTable = createBindingTable(${compiled.bindings.length});`,
    ...compiled.bindings.map((binding, slot) => {
      if (binding.kind === 'event') {
        return (
          `${pad}ɵsxListener(blockTable, ${slot}, ${binding.node}, ${JSON.stringify(binding.name)}, ` +
          `${eventHandlerBody(binding.handler, binding.modifiers)}, undefined, server);`
        );
      }

      // Block bodies build their own DOM, so the binding targets the text
      // node directly instead of Angular's rendered interpolation node.
      return binding.dependencies
        ? `${pad}ɵsxTextExpression(blockTable, ${slot}, ${binding.node}, ${sources(binding.dependencies)}, () => ${rewriteSxTextExpression(binding.source)});`
        : `${pad}ɵsxText(blockTable, ${slot}, ${binding.node}, ctx.${binding.source});`;
    }),
  ];
}

/**
 * Emits the construction code of one nested block. `context` names the loop
 * context variable in scope, if any: a nested block whose condition or
 * collection reads locals evaluates against it and is refreshed by the
 * enclosing update.
 */
function emitNestedBlock(
  nested: SxCompiledNestedBlock,
  spaces: number,
  context?: string,
): readonly string[] {
  const pad = ' '.repeat(spaces);
  const lines: string[] = [];

  if (nested.kind === 'conditional') {
    lines.push(
      `${pad}const ${nested.variable} = ɵcreateSxConditionalBlock(${nested.anchor}, [`,
    );

    for (const branch of nested.branches) {
      lines.push(`${pad}  {`);
      lines.push(`${pad}    source: ${nestedValue(branch.condition)},`);

      if (branch.match !== undefined) {
        lines.push(`${pad}    match: ${branch.match},`);
      }

      const roots = branch.body.rootNodes;

      lines.push(`${pad}    factory: () => {`);
      lines.push(indent(branch.body.createBody, spaces + 6));
      lines.push(...emitBodyContent(branch.body, spaces + 6, context));
      lines.push(
        ...bodyInstanceLines(branch.body, spaces + 6, roots),
      );
      lines.push(`${pad}    },`);
      lines.push(`${pad}  },`);
    }

    lines.push(`${pad}]);`);
    return lines;
  }

  const innerPad = spaces + 6;
  const roots = nested.body.rootNodes;

  lines.push(`${pad}const ${nested.variable} = ɵcreateSxKeyedBlock(`);
  lines.push(`${pad}  ${nested.anchor},`);
  lines.push(`${pad}  ${nestedValue(nested.source)},`);
  lines.push(`${pad}  {`);
  lines.push(`${pad}    create(${nested.item}, index, count) {`);
  lines.push(
    `${pad}      ${nestedContextDeclaration(nested, context)}`,
  );
  lines.push(indent(nested.body.createBody, innerPad));
  lines.push(...emitBodyContent(nested.body, innerPad, 'currentContext'));
  const rootRange = rootsReference(roots, lines, `${pad}      `);
  lines.push(`${pad}      return ɵcreateSxCompiledBlock(`);
  lines.push(`${pad}        ${rootRange.first},`);
  lines.push(`${pad}        ${rootRange.last},`);
  lines.push(`${pad}        (context) => {`);
  lines.push(`${pad}          currentContext = context;`);
  lines.push(indent(nested.body.updateBody, innerPad + 2));
  lines.push(...nestedRefreshLines(nested.body, innerPad + 2));
  lines.push(`${pad}        },`);
  lines.push(`${pad}        currentContext,`);

  if (nested.body.bindings.length > 0) {
    lines.push(`${pad}        () => {`);
    lines.push(`${pad}          blockTable.destroy();`);
    lines.push(`${pad}        },`);
  }

  lines.push(`${pad}      );`);
  lines.push(`${pad}    },`);
  lines.push(`${pad}    update(instance, ${nested.item}, index, count) {`);
  lines.push(
    `${pad}      instance.update({ ${contextLocals(nested.item)} });`,
  );
  lines.push(`${pad}    },`);
  lines.push(`${pad}  },`);
  lines.push(`${pad}  ${nestedTrackBy(nested)},`);

  if (nested.empty) {
    const emptyRoots = nested.empty.rootNodes;
    lines.push(`${pad}  () => {`);
    lines.push(indent(nested.empty.createBody, innerPad));
    lines.push(...emitBodyContent(nested.empty, innerPad, context));
    lines.push(
      ...bodyInstanceLines(nested.empty, innerPad, emptyRoots),
    );
    lines.push(`${pad}  },`);
  }

  lines.push(`${pad});`);
  return lines;
}

/** Loop-context entries shared by every compiled collection body. */
function contextLocals(item: string): string {
  return [
    item,
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
}

/** The loop context of a nested collection, extending the enclosing one. */
function nestedContextDeclaration(
  nested: Extract<SxCompiledNestedBlock, { kind: 'collection' }>,
  context?: string,
): string {
  const locals = contextLocals(nested.item);

  return context
    ? `let currentContext = { ...${context}, ${locals} };`
    : `let currentContext = { ${locals} };`;
}

function nestedRefreshLines(
  body: SxCompiledBlockBody,
  spaces: number,
): readonly string[] {
  const pad = ' '.repeat(spaces);

  return body.nested.map(
    nested => `${pad}${nested.variable}.refresh();`,
  );
}

function nestedTrackBy(
  nested: Extract<SxCompiledNestedBlock, { kind: 'collection' }>,
): string {
  const text = nested.trackBy.trim();
  // The collection source arrives through `ctx: any`, so the inferred item
  // type is unknown; the generated lambda annotates its parameters instead.
  const parameters = `(_index: any, ${nested.item}: any)`;

  if (text === nested.item) {
    return `${parameters} => ${nested.item}`;
  }

  return text === '_index'
    ? '(_index: any) => _index'
    : `${parameters} => ${text}`;
}

/** The nested blocks and binding table of one body. */
function emitBodyContent(
  body: SxCompiledBlockBody,
  spaces: number,
  context?: string,
): readonly string[] {
  const lines: string[] = [];

  for (const nested of body.nested) {
    lines.push(...emitNestedBlock(nested, spaces, context));
  }

  lines.push(...blockBindingLines(body, spaces));
  return lines;
}

/**
 * The `{ first, last, destroy }` instance a factory returns.
 *
 * A body with several roots collects them in an array: the runtime only needs
 * the range ends, and referencing every root keeps intermediate text nodes
 * from tripping `noUnusedLocals`.
 */
function bodyInstanceLines(
  body: SxCompiledBlockBody,
  spaces: number,
  roots: readonly string[],
): readonly string[] {
  const pad = ' '.repeat(spaces);
  const lines: string[] = [];
  const { first, last } = rootsReference(roots, lines, pad);

  lines.push(`${pad}return {`);
  lines.push(`${pad}  first: ${first},`);
  lines.push(`${pad}  last: ${last},`);
  lines.push(`${pad}  destroy() {`);

  if (body.bindings.length > 0) {
    lines.push(`${pad}    blockTable.destroy();`);
  }

  for (const nested of body.nested) {
    lines.push(`${pad}    ${nested.variable}.destroy();`);
  }

  lines.push(`${pad}  },`);
  lines.push(`${pad}};`);
  return lines;
}

/**
 * Returns the range-end expressions for a body's roots, emitting a roots array
 * when the range has more than one node.
 */
function rootsReference(
  roots: readonly string[],
  lines: string[],
  pad: string,
): { first: string; last: string } {
  if (roots.length <= 1) {
    const node = roots[0];

    // A body with no roots never renders; keep the contract typed anyway.
    return node === undefined
      ? { first: 'undefined as unknown as Node', last: 'undefined as unknown as Node' }
      : { first: node, last: node };
  }

  const array = `${roots[0]}Roots`;
  lines.push(`${pad}const ${array} = [${roots.join(', ')}];`);

  return {
    first: `${array}[0]`,
    last: `${array}[${array}.length - 1]`,
  };
}

/** Emits a nested condition/collection value. */
function nestedValue(value: SxCompiledValue | null): string {
  return value === null ? 'null' : loweredValue(value);
}
