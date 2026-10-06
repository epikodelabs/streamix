import {
  TmplAstBoundText,
  TmplAstElement,
  TmplAstForLoopBlock,
  TmplAstIfBlock,
  TmplAstLetDeclaration,
  TmplAstSwitchBlock,
  TmplAstText,
  parseTemplate,
  type TmplAstNode,
} from '@angular/compiler';

import type { SxReactiveSourceResolver } from './source-resolution';
import {
  analyzeSxExpression,
  rewriteLocalReads,
} from './text-expression';

export interface SxCompiledBlockBinding {
  readonly node: string;
  readonly source: string;
  /** Present when the interpolation is a compiled compound expression. */
  readonly dependencies?: readonly string[];
}

/**
 * A compiled reactive value used by a condition or collection: a direct
 * source, an expression over several sources, or — inside a collection body —
 * a read of the loop context.
 */
export type SxCompiledValue =
  | { readonly kind: 'source'; readonly source: string }
  | {
      readonly kind: 'expression';
      readonly expression: string;
      readonly dependencies: readonly string[];
    }
  /** Evaluated against the enclosing loop context, refreshed on item change. */
  | { readonly kind: 'local'; readonly expression: string };

/** A compiled body: the DOM its factory builds plus everything it owns. */
export interface SxCompiledBlockBody {
  readonly createBody: string;
  readonly updateBody: string;
  readonly rootNodes: readonly string[];
  readonly bindings: readonly SxCompiledBlockBinding[];
  readonly nested: readonly SxCompiledNestedBlock[];
}

export type SxCompiledNestedBlock =
  | {
      readonly kind: 'conditional';
      readonly variable: string;
      readonly anchor: string;
      readonly branches: readonly {
        readonly condition: SxCompiledValue | null;
        readonly match?: string;
        readonly body: SxCompiledBlockBody;
      }[];
    }
  | {
      readonly kind: 'collection';
      readonly variable: string;
      readonly anchor: string;
      readonly source: SxCompiledValue;
      readonly trackBy: string;
      readonly item: string;
      readonly body: SxCompiledBlockBody;
      readonly empty?: SxCompiledBlockBody;
    };

export interface SxCompiledBlockTemplate extends SxCompiledBlockBody {
  readonly bindingCount: number;
}

export interface SxBlockTemplateOptions {
  /**
   * Expression used to create DOM nodes. The caller is responsible for
   * defining it (`host.ownerDocument` keeps SSR working, where there is no
   * global `document`).
   */
  readonly documentExpression?: string;
  /**
   * When present, interpolations must resolve to a reactive source and bind
   * through the caller's binding table instead of context updates. This is the
   * mode used by compiler-owned control-flow blocks.
   */
  readonly resolveReactiveSource?: SxReactiveSourceResolver;
  /**
   * Allows interpolations that are not reactive sources to compile as
   * loop-local context reads (`item.name`). The collection runtime re-runs the
   * compiled update on every item change.
   */
  readonly allowLocals?: boolean;
}

interface EmitState {
  readonly template: string;
  readonly document: string;
  readonly create: string[];
  readonly updates: string[];
  readonly roots: string[];
  readonly bindings: SxCompiledBlockBinding[];
  readonly nested: SxCompiledNestedBlock[];
  /** `@let` bindings visible to the expressions that follow them. */
  readonly lets: Map<string, string>;
  readonly resolveReactiveSource?: SxReactiveSourceResolver;
  readonly allowLocals: boolean;
  nextNode: number;
  bindingCount: number;
}

function createEmitState(
  template: string,
  options: SxBlockTemplateOptions,
): EmitState {
  return {
    template,
    document: options.documentExpression ?? 'document',
    create: [],
    updates: [],
    roots: [],
    bindings: [],
    nested: [],
    lets: new Map(),
    resolveReactiveSource: options.resolveReactiveSource,
    allowLocals: options.allowLocals === true,
    nextNode: 0,
    bindingCount: 0,
  };
}

function toBlockBody(state: EmitState): SxCompiledBlockBody {
  return {
    createBody: state.create.join('\n'),
    updateBody: state.updates.join('\n'),
    rootNodes: state.roots,
    bindings: state.bindings,
    nested: state.nested,
  };
}

/**
 * Compiles a structural block template into direct DOM creation/update code.
 *
 * This intentionally implements a narrow first-class subset instead of
 * retaining a hidden runtime HTML parser. Unsupported Angular constructs fail
 * at build time.
 */
export function compileSxBlockTemplate(
  template: string,
  templateUrl = 'sx-block.html',
  options: SxBlockTemplateOptions = {},
): SxCompiledBlockTemplate {
  const parsed = parseTemplate(template, templateUrl, {
    preserveWhitespaces: true,
  });

  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map(error => error.toString()).join('\n'));
  }

  const state = createEmitState(template, options);

  for (const node of parsed.nodes) {
    state.roots.push(...emitNode(node, state));
  }

  return {
    ...appendTrailingRoot(state),
    bindingCount: state.bindingCount,
  };
}

/**
 * A body that owns nested blocks ends with an empty text node. Nested content
 * renders after its anchor, so the enclosing range must end past every anchor
 * for keyed moves and removals to stay correct.
 */
function appendTrailingRoot(state: EmitState): SxCompiledBlockBody {
  if (state.nested.length > 0) {
    const tail = nextVariable(state, 'tail');
    state.create.push(
      `const ${tail} = ${state.document}.createTextNode("");`,
    );
    state.roots.push(tail);
  }

  return toBlockBody(state);
}

/**
 * Compiles a nested body (an inner `@if`/`@for` branch) into its own factory
 * body. Slot numbers restart per body because every body owns its table.
 */
function compileNestedBody(
  children: readonly TmplAstNode[],
  parent: EmitState,
): SxCompiledBlockBody {
  const state = createEmitState(parent.template, {
    documentExpression: parent.document,
    resolveReactiveSource: parent.resolveReactiveSource,
    allowLocals: parent.allowLocals,
  });

  // `@let` bindings are scoped to the body that declares them.
  for (const [name, value] of parent.lets) {
    state.lets.set(name, value);
  }

  for (const child of children) {
    state.roots.push(...emitNode(child, state));
  }

  return appendTrailingRoot(state);
}

function emitNode(
  node: TmplAstNode,
  state: EmitState,
): readonly string[] {
  if (node instanceof TmplAstElement) {
    return [emitElement(node, state)];
  }

  if (node instanceof TmplAstText) {
    return [emitStaticText(node.value, state)];
  }

  if (node instanceof TmplAstBoundText) {
    return emitBoundText(
      sourceSlice(state.template, node.sourceSpan.start.offset, node.sourceSpan.end.offset),
      state,
    );
  }

  if (node instanceof TmplAstLetDeclaration) {
    emitLet(node, state);
    return [];
  }

  if (node instanceof TmplAstIfBlock) {
    return [emitNestedConditional(node, state)];
  }

  if (node instanceof TmplAstSwitchBlock) {
    return [emitNestedSwitch(node, state)];
  }

  if (node instanceof TmplAstForLoopBlock) {
    return [emitNestedCollection(node, state)];
  }

  const type = node.constructor?.name ?? 'unknown';
  throw new Error(
    `Unsupported sx structural template node: ${type}. ` +
    'The direct structural compiler supports static elements, static attributes, text, interpolations, @let, and nested @if/@for/@switch.',
  );
}

/**
 * `@let name = expression;` inside a compiled body. The declaration is
 * inlined into the expressions that read it, so a `@let` over reactive sources
 * updates exactly like the expression it names.
 */
function emitLet(
  node: TmplAstLetDeclaration,
  state: EmitState,
): void {
  const value = (node as { value?: { source?: unknown } }).value;
  const source = typeof value?.source === 'string' ? value.source.trim() : '';

  if (!source) {
    throw new Error(
      `Unsupported sx @let value for ${JSON.stringify(node.name)}.`,
    );
  }

  state.lets.set(node.name, source);
}

/** A `item.name` / `$index` style read of the collection context. */
const LOCAL_READ = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** Substitutes `@let` names so inlined expressions keep their meaning. */
function substituteLets(
  expression: string,
  state: EmitState,
): string {
  if (state.lets.size === 0) {
    return expression;
  }

  let result = expression;
  let guard = 0;

  // A `@let` may reference earlier declarations; resolve them transitively.
  while (guard < 8) {
    let replaced = false;

    for (const [name, value] of state.lets) {
      const pattern = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, 'g');

      if (pattern.test(result)) {
        result = result.replace(pattern, `(${value})`);
        replaced = true;
      }
    }

    if (!replaced) {
      break;
    }

    guard += 1;
  }

  return result;
}

/**
 * A nested `@if`/`@else if`/`@else` inside a compiled body: an anchor comment
 * plus a conditional block constructed after the enclosing DOM is assembled.
 */
function emitNestedConditional(
  block: TmplAstIfBlock,
  state: EmitState,
): string {
  const anchor = emitNestedAnchor(state);
  const variable = nextVariable(state, 'block');
  const branches: {
    condition: SxCompiledValue | null;
    match?: string;
    body: SxCompiledBlockBody;
  }[] = [];

  for (const branch of block.branches) {
    const condition = branch.expression
      ? compileNestedValue(
          substituteLets(
            expressionSourceOf(branch.expression, state.template),
            state,
          ),
          state,
        )
      : null;

    branches.push({
      condition,
      body: compileNestedBody(branch.children, state),
    });
  }

  state.nested.push({
    kind: 'conditional',
    variable,
    anchor,
    branches,
  });

  return anchor;
}

/** A nested `@switch` inside a compiled body. */
function emitNestedSwitch(
  block: TmplAstSwitchBlock,
  state: EmitState,
): string {
  const anchor = emitNestedAnchor(state);
  const variable = nextVariable(state, 'block');
  const source = compileNestedValue(
    substituteLets(
      expressionSourceOf(block.expression, state.template),
      state,
    ),
    state,
  );
  const cases: {
    condition: SxCompiledValue | null;
    match?: string;
    body: SxCompiledBlockBody;
  }[] = [];
  const defaults: typeof cases = [];

  for (const group of block.groups) {
    const body = compileNestedBody(group.children, state);

    for (const caseNode of group.cases) {
      if (!caseNode.expression) {
        defaults.push({ condition: null, body });
        continue;
      }

      const match = expressionSourceOf(caseNode.expression, state.template);

      if (!match || !isLiteralText(match)) {
        throw new Error(
          `Unsupported sx @case value ${JSON.stringify(match)}. ` +
          'Compiled blocks compare literal case values only.',
        );
      }

      cases.push({ condition: source, match, body });
    }
  }

  // Defaults render only when no case matched, so they go last.
  state.nested.push({
    kind: 'conditional',
    variable,
    anchor,
    branches: [...cases, ...defaults],
  });

  return anchor;
}

/** A nested `@for`/`@empty` inside a compiled body. */
function emitNestedCollection(
  block: TmplAstForLoopBlock,
  state: EmitState,
): string {
  const anchor = emitNestedAnchor(state);
  const variable = nextVariable(state, 'block');
  const source = compileNestedValue(
    substituteLets(
      expressionSourceOf(block.expression, state.template),
      state,
    ),
    state,
  );
  const item = block.item.name;
  const trackBy = block.trackBy
    ? trackByText(block.trackBy, state.template, item)
    : item;

  const body = compileNestedBody(block.children, state);
  const empty = block.empty
    ? compileNestedBody(block.empty.children, state)
    : undefined;

  state.nested.push({
    kind: 'collection',
    variable,
    anchor,
    source,
    trackBy,
    item,
    body,
    empty,
  });

  return anchor;
}

function emitNestedAnchor(state: EmitState): string {
  const anchor = nextVariable(state, 'anchor');
  state.create.push(
    `const ${anchor} = ${state.document}.createComment("sx");`,
  );
  return anchor;
}

/**
 * Condition or collection value of a nested block: a resolved source, an
 * expression over sources, or a loop-local read. Anything else is refused —
 * partial ownership would go stale.
 */
function compileNestedValue(
  expression: string,
  state: EmitState,
): SxCompiledValue {
  const text = expression.trim();

  if (!text) {
    throw new Error('Unsupported sx block without an expression.');
  }

  if (state.resolveReactiveSource) {
    const analysis = analyzeSxExpression(text, state.resolveReactiveSource);

    if (analysis?.mode === 'direct' && analysis.directSource) {
      return { kind: 'source', source: analysis.directSource };
    }

    if (analysis?.mode === 'expression') {
      return {
        kind: 'expression',
        expression: analysis.expression,
        dependencies: analysis.dependencies,
      };
    }

    if (analysis) {
      throw new Error(
        `Unsupported sx block expression ${JSON.stringify(text)}. ` +
        'Every read must be reactive; expressions that mix atoms with state Angular owns cannot be compiled.',
      );
    }
  }

  if (state.allowLocals) {
    return { kind: 'local', expression: text };
  }

  throw new Error(
    `Unsupported sx block expression ${JSON.stringify(text)}. ` +
    'A nested block reads reactive sources or the enclosing loop context.',
  );
}

function expressionSourceOf(
  expression: unknown,
  template: string,
): string {
  const source = (expression as { source?: unknown } | undefined)?.source;

  if (typeof source === 'string' && source.trim()) {
    return source.trim();
  }

  const span = (expression as { sourceSpan?: { start: { offset: number }; end: { offset: number } } } | undefined)?.sourceSpan;

  return span ? template.slice(span.start.offset, span.end.offset) : '';
}

function trackByText(
  trackBy: unknown,
  template: string,
  item: string,
): string {
  const text = expressionSourceOf(trackBy, template);

  return text === '$index' ? '_index' : text || item;
}

/** Accepts only the literals a generated comparison can evaluate directly. */
function isLiteralText(text: string): boolean {
  const trimmed = text.trim();

  if (
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null' ||
    /^-?\d+(\.\d+)?$/.test(trimmed)
  ) {
    return true;
  }

  const quote = trimmed[0];

  return (
    (quote === "'" || quote === '"') &&
    trimmed.length > 1 &&
    trimmed[trimmed.length - 1] === quote &&
    !trimmed.slice(1, -1).includes(quote)
  );
}

function emitElement(
  element: TmplAstElement,
  state: EmitState,
): string {
  if (element.inputs.length > 0 || element.outputs.length > 0) {
    throw new Error(
      `Bindings/events inside compiled sx structural element <${element.name}> are not yet supported. ` +
      'Use simple text interpolation in this compiler stage.',
    );
  }

  const variable = nextVariable(state, 'el');
  state.create.push(
    `const ${variable} = ${state.document}.createElement(${JSON.stringify(element.name)});`,
  );

  for (const attribute of element.attributes) {
    state.create.push(
      `${variable}.setAttribute(${JSON.stringify(attribute.name)}, ${JSON.stringify(attribute.value)});`,
    );
  }

  for (const child of element.children) {
    for (const childVariable of emitNode(child, state)) {
      state.create.push(`${variable}.appendChild(${childVariable});`);
    }
  }

  return variable;
}

function emitStaticText(
  value: string,
  state: EmitState,
): string {
  const variable = nextVariable(state, 'text');
  state.create.push(
    `const ${variable} = ${state.document}.createTextNode(${JSON.stringify(value)});`,
  );
  return variable;
}

/**
 * One text node per interpolation part. Splitting lets a single text node mix
 * element properties as well as text runs and static text:
 *
 * - a part that resolves to an atom becomes its own binding-table slot, so it
 *   updates when the atom emits;
 * - a part that is a loop-local (`item.name`, `$index`) is written by the
 *   compiled update the collection runtime re-runs;
 * - literal runs become static text nodes.
 */
function emitBoundText(
  raw: string,
  state: EmitState,
): readonly string[] {
  const parts = parseInterpolation(raw);
  const variables: string[] = [];

  for (const part of parts) {
    if (part.kind === 'text') {
      if (!part.value) {
        continue;
      }

      const variable = nextVariable(state, 'text');
      state.create.push(
        `const ${variable} = ${state.document}.createTextNode(${JSON.stringify(part.value)});`,
      );
      variables.push(variable);
      continue;
    }

    const variable = nextVariable(state, 'text');
    state.create.push(
      `const ${variable} = ${state.document}.createTextNode("");`,
    );
    variables.push(variable);

    const expression = substituteLets(part.value, state);
    const source = state.resolveReactiveSource?.(expression);

    if (source && state.resolveReactiveSource) {
      state.bindings.push({ node: variable, source });
      state.bindingCount += 1;
      continue;
    }

    // A compound expression whose reads are all reactive sources compiles to
    // a multi-source binding-table slot. Angular-only features and reads of
    // loop locals mixed with sources stay unsupported.
    if (state.resolveReactiveSource) {
      const analysis = analyzeSxExpression(
        part.value,
        state.resolveReactiveSource,
      );

      if (analysis?.mode === 'expression') {
        state.bindings.push({
          node: variable,
          source: analysis.expression,
          dependencies: analysis.dependencies,
        });
        state.bindingCount += 1;
        continue;
      }

      if (analysis?.mode === 'unsupported' || !state.allowLocals) {
        throw new Error(
          `Unsupported sx structural interpolation: ${JSON.stringify(part.value)}. ` +
          'Only atom reads and loop-local values are supported in a compiled block body; ' +
          'an expression that mixes both cannot be compiled.',
        );
      }
    }

    // Without a resolver (the context-based compilation mode) only plain
    // property paths can be resolved against the loop context.
    if (!state.resolveReactiveSource && !LOCAL_READ.test(expression)) {
      throw new Error(
        `Unsupported sx structural interpolation: ${JSON.stringify(part.value)}. ` +
        'Only local/property reads are supported in the direct block compiler.',
      );
    }

    // Anything left is a loop-local expression, resolved against the
    // collection context at update time.
    state.updates.push(
      `${variable}.data = ɵsxString(${rewriteLocalReads(expression, 'currentContext')});`,
    );
    state.bindingCount += 1;
  }

  return variables;
}


function nextVariable(
  state: EmitState,
  prefix: string,
): string {
  return `${prefix}${state.nextNode++}`;
}

function sourceSlice(
  template: string,
  start: number,
  end: number,
): string {
  return template.slice(start, end);
}

type InterpolationPart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'expression'; readonly value: string };

function parseInterpolation(
  raw: string,
): readonly InterpolationPart[] {
  const parts: InterpolationPart[] = [];
  const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw))) {
    if (match.index > cursor) {
      parts.push({
        kind: 'text',
        value: raw.slice(cursor, match.index),
      });
    }

    parts.push({
      kind: 'expression',
      value: match[1].trim(),
    });

    cursor = match.index + match[0].length;
  }

  if (cursor < raw.length) {
    parts.push({
      kind: 'text',
      value: raw.slice(cursor),
    });
  }

  if (!parts.some(part => part.kind === 'expression')) {
    throw new Error(
      `Expected interpolation in bound text: ${JSON.stringify(raw)}.`,
    );
  }

  return parts;
}
