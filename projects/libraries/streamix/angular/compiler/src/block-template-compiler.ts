import ts from 'typescript';

import {
  TmplAstBoundText,
  TmplAstElement,
  TmplAstForLoopBlock,
  TmplAstIfBlock,
  TmplAstLetDeclaration,
  TmplAstSwitchBlock,
  TmplAstText,
  parseTemplate,
  type TmplAstBoundEvent,
  type TmplAstBoundAttribute,
  type TmplAstNode,
} from '@angular/compiler';

import {
  isLiteralArgument,
  parseNativeEventBinding,
  splitArguments,
} from './event-binding';

import type { SxReactiveSourceResolver } from './source-resolution';
import {
  analyzeSxExpression,
  rewriteLocalReads,
  stripAnyCasts,
  rewriteSxTextExpression,
} from './text-expression';

export type SxCompiledBlockBinding =
  | {
      readonly kind: 'text';
      readonly node: string;
      readonly source: string;
      /** Present when the interpolation is a compiled compound expression. */
      readonly dependencies?: readonly string[];
      /** Re-read on enclosing keyed-row context changes as well as atom emissions. */
      readonly contextual?: boolean;
    }
  | {
      readonly kind: 'property' | 'attribute' | 'class' | 'style';
      readonly node: string;
      readonly name: string;
      readonly source: string;
      readonly dependencies?: readonly string[];
      /** Reader closes over the latest enclosing loop context. */
      readonly contextual?: boolean;
    }
  | {
      readonly kind: 'event';
      readonly node: string;
      /** DOM event type. */
      readonly name: string;
      /** Rewritten handler call, already prefixed with the component context. */
      readonly handler: string;
      readonly modifiers?: readonly string[];
    };

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
      readonly contextual?: boolean;
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
      readonly aliases: readonly SxLoopAlias[];
      readonly body: SxCompiledBlockBody;
      readonly empty?: SxCompiledBlockBody;
    };

export interface SxCompiledBlockTemplate extends SxCompiledBlockBody {
  readonly bindingCount: number;
}

export interface SxLoopAlias {
  readonly name: string;
  readonly value: string;
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
  /** In production lowering, the visible @for variable and context aliases. */
  readonly localNames?: readonly string[];
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
  readonly localNames?: ReadonlySet<string>;
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
    localNames: options.localNames ? new Set(options.localNames) : undefined,
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
 *
 * A multi-root body chains its roots inside a document fragment: the runtime
 * moves instances by walking `first.nextSibling` up to `last`, which requires
 * the roots to be siblings before the first render. Detached roots that were
 * never chained made every multi-root body throw "Invalid sx structural DOM
 * range" the first time its block rendered.
 */
function appendTrailingRoot(state: EmitState): SxCompiledBlockBody {
  if (state.nested.length > 0) {
    const tail = nextVariable(state, 'tail');
    state.create.push(
      `const ${tail} = ${state.document}.createTextNode("");`,
    );
    state.roots.push(tail);
  }

  if (state.roots.length > 1) {
    const fragment = nextVariable(state, 'fragment');
    state.create.push(
      `const ${fragment} = ${state.document}.createDocumentFragment();`,
    );
    for (const root of state.roots) {
      state.create.push(`${fragment}.appendChild(${root});`);
    }
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
  additionalLocals: readonly string[] = [],
): SxCompiledBlockBody {
  const state = createEmitState(parent.template, {
    documentExpression: parent.document,
    resolveReactiveSource: parent.resolveReactiveSource,
    allowLocals: parent.allowLocals || additionalLocals.length > 0,
    localNames: parent.localNames || additionalLocals.length > 0
      ? [...(parent.localNames ?? []), ...additionalLocals]
      : undefined,
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

/**
 * An `(event)="handler(...)"` inside a compiled body. Arguments may read the
 * loop context or a reactive source; the dispatch-time call is rewritten
 * accordingly, so `(click)="select(row.id)"` selects the clicked row.
 */
function compileBlockEvent(
  element: TmplAstElement,
  output: TmplAstBoundEvent,
  variable: string,
  state: EmitState,
): SxCompiledBlockBinding {
  const parsed = parseNativeEventBinding(
    element.name,
    output.name,
    output.phase,
    output.target,
    expressionSourceOf(output.handler, state.template),
    { allowValueArguments: true },
  );

  if (!parsed) {
    throw new Error(
      `Unsupported event binding on <${element.name}> inside a compiled block. ` +
      'Only native DOM events with a method-call handler are compiled.',
    );
  }

  return {
    kind: 'event',
    node: variable,
    name: parsed.type,
    handler: `ctx.${parsed.method}(${rewriteEventArguments(parsed.argumentText, state)})`,
    modifiers: parsed.modifiers.length > 0 ? parsed.modifiers : undefined,
  };
}

function rewriteEventArguments(argumentText: string, state: EmitState): string {
  return splitArguments(argumentText)
    .filter(part => part.length > 0)
    .map(part => {
      if (part === '$event') {
        return 'event';
      }

      if (isLiteralArgument(part) && part !== '$event') {
        return part;
      }

      const source = state.resolveReactiveSource?.(part);

      if (source) {
        return `ctx.${source}.value`;
      }

      return rewriteLocalReads(
        substituteLets(part, state),
        'currentContext',
      );
    })
    .join(', ');
}

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
      const next = replaceIdentifier(result, name, `(${value})`);

      if (next !== result) {
        result = next;
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
 * Replaces whole-identifier occurrences outside string literals. The previous
 * pattern substitution also rewrote `@let` names appearing inside string
 * content, silently changing the compiled value.
 */
function replaceIdentifier(
  text: string,
  name: string,
  replacement: string,
): string {
  let result = '';
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === '"' || char === "'" || char === '`') {
      const end = endQuotedText(text, index);
      result += text.slice(index, end);
      index = end;
      continue;
    }

    if (isIdentifierStartChar(char) && !isTokenChar(text[index - 1])) {
      const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(index));

      if (match && match[0] === name) {
        result += replacement;
        index += name.length;
        continue;
      }
    }

    result += char;
    index += 1;
  }

  return result;
}

function isIdentifierStartChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z_$]/.test(char);
}

function isTokenChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_$.]/.test(char);
}

/** One past the closing quote of the string starting at `start`. */
function endQuotedText(text: string, start: number): number {
  const quote = text[start];
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === quote) {
      return index + 1;
    }
  }

  return text.length;
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

  const body = compileNestedBody(block.children, state, [
    item, 'index', 'count', 'first', 'last', 'even', 'odd',
    '$index', '$count', '$first', '$last', '$even', '$odd',
    ...block.contextVariables.map(alias => alias.name),
  ]);
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
    aliases: block.contextVariables.map(variable => ({
      name: variable.name,
      value: variable.value,
    })),
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
      const mixed = analysis.mode === 'unsupported'
        ? mixedBlockExpression(text, analysis.expression, analysis.dependencies, state)
        : undefined;
      if (mixed) {
        return { kind: 'expression', ...mixed };
      }
      throw new Error(
        `Unsupported sx block expression ${JSON.stringify(text)}. ` +
        'Reactive sources may mix only with proven loop-local reads; Angular-owned component state is not tracked.',
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
  // The track expression is spliced into a generated JavaScript lambda, so a
  // `$any(...)` cast has to go the way of every other compiled expression.
  const text = stripAnyCasts(expressionSourceOf(trackBy, template));

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

/**
 * Only native DOM sinks already supported by the static compiler may be
 * written without Angular's sanitizer. URL, resource, HTML, and dynamic
 * attribute names stay Angular-owned and are rejected inside sx blocks.
 */
const SAFE_BLOCK_PROPERTIES = new Set([
  'alt', 'checked', 'className', 'cols', 'colSpan', 'contentEditable',
  'disabled', 'draggable', 'height', 'hidden', 'htmlFor', 'id', 'max',
  'min', 'multiple', 'name', 'open', 'placeholder', 'readOnly', 'required',
  'rows', 'rowSpan', 'selected', 'spellcheck', 'step', 'tabIndex',
  'textContent', 'title', 'type', 'value', 'width',
]);
const SAFE_BLOCK_STYLES = new Set([
  'background', 'background-color', 'border-radius', 'bottom', 'color',
  'display', 'font-size', 'gap', 'height', 'left', 'line-height', 'margin',
  'max-height', 'max-width', 'min-height', 'min-width', 'opacity', 'padding',
  'right', 'top', 'transform', 'visibility', 'width', 'z-index',
]);

function boundInputKind(
  input: TmplAstBoundAttribute,
  state: EmitState,
): { kind: 'property' | 'attribute' | 'class' | 'style'; name: string; expression: string } {
  const authored = sourceSlice(state.template, input.sourceSpan.start.offset, input.sourceSpan.end.offset);
  const bracket = /^\s*\[([^\]]+)\]\s*=/.exec(authored);
  const interpolated = bracket ? null : /^\s*([^\s=]+)\s*=/.exec(authored);
  const name = bracket?.[1] ?? interpolated?.[1] ?? input.name;
  const interpolations = [...authored.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
  let expression = expressionSourceOf(input.value, state.template);
  if (interpolations.length > 0) {
    // Compile all interpolated runs, keeping literal text intact and each
    // reactive read visible to the same dependency analyzer as normal inputs.
    const value = /=[ \t\r\n]*(["'])([\s\S]*)\1\s*$/.exec(authored);
    if (!value) throw new Error(`Unsupported interpolated attribute ${JSON.stringify(name)}.`);
    const pieces: string[] = [];
    const inner = value[2];
    const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
    let cursor = 0, match: RegExpExecArray | null;
    while ((match = pattern.exec(inner))) {
      if (match.index > cursor) pieces.push(JSON.stringify(inner.slice(cursor, match.index)));
      pieces.push(`(${match[1].trim()})`);
      cursor = match.index + match[0].length;
    }
    if (cursor < inner.length) pieces.push(JSON.stringify(inner.slice(cursor)));
    expression = pieces.join(' + ') || '""';
  }

  const normalized = name === 'readonly' ? 'readOnly' :
    name === 'tabindex' ? 'tabIndex' :
    name === 'colspan' ? 'colSpan' : name === 'rowspan' ? 'rowSpan' : name;
  if (name.startsWith('class.') && /^[A-Za-z_-][\w-]*$/.test(name.slice(6))) {
    return { kind: 'class', name: name.slice(6), expression };
  }
  if (name.startsWith('style.') && SAFE_BLOCK_STYLES.has(name.slice(6).toLowerCase())) {
    return { kind: 'style', name: name.slice(6), expression };
  }
  if (name.startsWith('attr.')) {
    const attribute = name.slice(5);
    if (/^(?:data-[\w-]+|aria-[\w-]+|title|role|tabindex)$/.test(attribute)) {
      return { kind: 'attribute', name: attribute, expression };
    }
  }
  // Angular's attribute interpolation is semantically [attr.name], never a
  // DOM property; reject security-sensitive sinks consistently.
  if (interpolations.length && /^(?:data-[\w-]+|aria-[\w-]+|title|role|tabindex)$/.test(name)) {
    return { kind: 'attribute', name, expression };
  }
  if (!name.includes('.') && SAFE_BLOCK_PROPERTIES.has(normalized)) {
    return { kind: 'property', name: normalized, expression };
  }
  throw new Error(
    `Unsupported or sanitizer-sensitive compiled block binding ${JSON.stringify(name)}. ` +
    'Only safe DOM properties, attr.title/role/tabindex/data-/aria-, class.X, and safe style.X are compiled.',
  );
}

/**
 * A mixed block expression has two independent invalidation inputs:
 *
 * 1. Streamix dependency emissions (the binding table subscription); and
 * 2. a keyed-row update (refreshExpression after currentContext is replaced).
 *
 * Its authored expression is validated before rewriting, so Angular pipes,
 * writes, arbitrary method calls and unproven component fields cannot be
 * executed under changed direct-DOM semantics.
 */
function mixedBlockExpression(
  authored: string,
  normalized: string,
  dependencies: readonly string[],
  state: EmitState,
): { expression: string; dependencies: readonly string[]; contextual: true } | undefined {
  if (!state.allowLocals || dependencies.length === 0) return undefined;

  const source = stripAnyCasts(authored);
  const parsed = ts.createSourceFile(
    'sx-mixed-expression.ts', `(${source});`, ts.ScriptTarget.Latest, true,
  );
  if ((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length > 0) return undefined;
  const statement = parsed.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return undefined;

  const safe = (node: ts.Node): boolean => {
    if (ts.isParenthesizedExpression(node)) return safe(node.expression);
    if (ts.isIdentifier(node)) {
      return state.localNames ? state.localNames.has(node.text) ||
        !!state.resolveReactiveSource?.(node.text) ||
        ['undefined', 'NaN', 'Infinity'].includes(node.text) : true;
    }
    if (ts.isNumericLiteral(node) || ts.isStringLiteral(node) ||
        node.kind === ts.SyntaxKind.TrueKeyword ||
        node.kind === ts.SyntaxKind.FalseKeyword ||
        node.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isPropertyAccessExpression(node)) {
      // The component/source roots and local roots must be proven separately.
      if (state.localNames) {
        const full = node.getText(parsed);
        if (state.resolveReactiveSource?.(full)) return true;
        const root = full.match(/^[A-Za-z_$][\w$]*/)?.[0];
        if (root && !state.localNames.has(root) &&
            !state.resolveReactiveSource?.(full) &&
            !state.resolveReactiveSource?.(root)) return false;
      }
      return safe(node.expression);
    }
    if (ts.isElementAccessExpression(node)) return safe(node.expression) && safe(node.argumentExpression);
    if (ts.isPrefixUnaryExpression(node)) {
      return [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken].includes(node.operator) &&
        safe(node.operand);
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      return [
        ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken,
        ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken,
        ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken,
        ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
        ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
      ].includes(operator) && safe(node.left) && safe(node.right);
    }
    if (ts.isConditionalExpression(node)) {
      return safe(node.condition) && safe(node.whenTrue) && safe(node.whenFalse);
    }
    return false;
  };

  if (!safe(statement.expression)) return undefined;

  // Need an actual loop-local read, not a component field that failed the
  // analyzer for another reason. The rewritten expression already qualifies
  // every Streamix read with ctx; the remaining paths resolve in currentContext.
  const rewritten = rewriteLocalReads(
    rewriteSxTextExpression(normalized), 'currentContext',
  );
  // The rewrite must have installed at least one local read, otherwise the
  // analysis was unsupported for a reason unrelated to mixed loop context.
  if (!rewritten.includes('ɵsxReadLocal(currentContext, ')) return undefined;

  return { expression: rewritten, dependencies, contextual: true };
}

function compileBlockInput(
  input: TmplAstBoundAttribute,
  variable: string,
  state: EmitState,
): void {
  const { kind, name, expression } = boundInputKind(input, state);
  const expanded = substituteLets(expression, state);
  const analysis = analyzeSxExpression(expanded, state.resolveReactiveSource);
  if (analysis?.mode === 'direct' && analysis.directSource) {
    state.bindings.push({ kind, node: variable, name, source: analysis.directSource });
  } else if (analysis?.mode === 'expression') {
    state.bindings.push({
      kind, node: variable, name,
      source: analysis.expression, dependencies: analysis.dependencies,
    });
  } else if (analysis?.mode === 'unsupported') {
    const mixed = mixedBlockExpression(expanded, analysis.expression, analysis.dependencies, state);
    if (!mixed) {
      throw new Error(`Unsupported mixed Streamix/local compiled block binding ${JSON.stringify(expression)}.`);
    }
    state.bindings.push({ kind, node: variable, name, source: mixed.expression,
      dependencies: mixed.dependencies, contextual: true });
  } else if (state.allowLocals && !isProvenLocalExpression(expanded, state.localNames)) {
    throw new Error(`Unknown loop-local in compiled block binding ${JSON.stringify(expression)}.`);
  } else if (state.allowLocals &&
      !/[|;`]/.test(expanded) &&
      !/[A-Za-z_$][\w$.]*\s*\(/.test(expanded)) {
    const local = rewriteLocalReads(stripAnyCasts(expanded), 'currentContext');
    if (kind === 'property') {
      // Loop-local reads are `unknown`; index through a widened element so the
      // generated body type-checks against typed DOM properties.
      state.updates.push(`(${variable} as unknown as Record<string, unknown>)[${JSON.stringify(name)}] = ${local};`);
    } else if (kind === 'class') {
      state.updates.push(`${variable}.classList.toggle(${JSON.stringify(name)}, Boolean(${local}));`);
    } else if (kind === 'style') {
      state.updates.push(`{ const value = ${local}; if (value == null || value === false) ${variable}.style.removeProperty(${JSON.stringify(name)}); else ${variable}.style.setProperty(${JSON.stringify(name)}, String(value)); }`);
    } else {
      state.updates.push(`{ const value = ${local}; if (value == null) ${variable}.removeAttribute(${JSON.stringify(name)}); else ${variable}.setAttribute(${JSON.stringify(name)}, String(value)); }`);
    }
  } else {
    throw new Error(
      `Unsupported compiled block binding ${JSON.stringify(expression)}: ` +
      'a static @if body requires reactive sources; @for bodies may also read loop-local fields.',
    );
  }
  state.bindingCount += 1;
}

function emitElement(
  element: TmplAstElement,
  state: EmitState,
): string {
  const variable = nextVariable(state, 'el');
  state.create.push(
    `const ${variable} = ${state.document}.createElement(${JSON.stringify(element.name)});`,
  );

  for (const input of element.inputs) compileBlockInput(input, variable, state);
  for (const output of element.outputs) {
    state.bindings.push(compileBlockEvent(element, output, variable, state));
  }

  for (const attribute of element.attributes) {
    if (attribute.value.includes('{{')) {
      throw new Error(`Unsupported unparsed interpolation in compiled attribute ${JSON.stringify(attribute.name)}.`);
    }
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
      state.bindings.push({ kind: 'text', node: variable, source });
      state.bindingCount += 1;
      continue;
    }

    // A compound expression whose reads are all reactive sources compiles to
    // a multi-source binding-table slot. Angular-only features and reads of
    // loop locals mixed with sources stay unsupported.
    if (state.resolveReactiveSource) {
      const analysis = analyzeSxExpression(
        expression,
        state.resolveReactiveSource,
      );

      if (analysis?.mode === 'expression') {
        state.bindings.push({
          kind: 'text',
          node: variable,
          source: analysis.expression,
          dependencies: analysis.dependencies,
        });
        state.bindingCount += 1;
        continue;
      }

      if (analysis?.mode === 'unsupported') {
        const mixed = mixedBlockExpression(expression, analysis.expression, analysis.dependencies, state);
        if (mixed) {
          state.bindings.push({ kind: 'text', node: variable, source: mixed.expression,
            dependencies: mixed.dependencies, contextual: true });
          state.bindingCount += 1;
          continue;
        }
      }
      if (analysis?.mode === 'unsupported' || !state.allowLocals) {
        throw new Error(
          `Unsupported sx structural interpolation: ${JSON.stringify(part.value)}. ` +
          'Only reactive, local, and supported mixed loop-local/reactive expressions can be compiled.',
        );
      }
    }

    // Pipes and calls require Angular's template evaluator (and a method call
    // would lose its `this` receiver after local-path rewriting), so reject
    // them instead of emitting JavaScript with different semantics. Plain
    // local arithmetic remains safe and is evaluated during block updates.
    if (
      /(^|[^|])\|([^|]|$)/.test(expression) ||
      /[A-Za-z_$][\w$.]*\s*\(/.test(expression) ||
      (!state.resolveReactiveSource && !LOCAL_READ.test(expression))
    ) {
      throw new Error(
        `Unsupported sx structural interpolation: ${JSON.stringify(part.value)}. ` +
        'Only local/property reads are supported in the direct block compiler.',
      );
    }

    // Anything left is a loop-local expression, resolved against the
    // collection context at update time.
    if (!isProvenLocalExpression(expression, state.localNames)) {
      throw new Error(`Unknown loop-local in compiled structural interpolation: ${JSON.stringify(part.value)}.`);
    }
    state.updates.push(
      `${variable}.data = ɵsxString(${rewriteLocalReads(expression, 'currentContext')});`,
    );
    state.bindingCount += 1;
  }

  return variables;
}

/** Reject misspelled loop locals instead of generating an undefined read. */
function isProvenLocalExpression(
  expression: string,
  localNames: ReadonlySet<string> | undefined,
): boolean {
  if (!localNames) return true;
  const file = ts.createSourceFile('sx-local.ts', `(${expression});`, ts.ScriptTarget.Latest, true);
  let safe = true;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) return;
      if (!localNames.has(node.text) && !['undefined', 'NaN', 'Infinity'].includes(node.text)) {
        safe = false;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return safe;
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
