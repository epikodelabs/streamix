import {
  TmplAstBoundText,
  TmplAstContent,
  TmplAstElement,
  TmplAstText,
  parseTemplate,
  type ParseSourceSpan,
  type TmplAstBoundEvent,
  type TmplAstNode,
} from '@angular/compiler';

import {
  createBindingPlan,
  type SxBindingKind,
  type SxBindingPlan,
  type SxSourceSpan,
} from './binding-plan';
import { parseNativeEventBinding } from './event-binding';
import {
  analyzeSxExpression,
  analyzeSxTextInterpolation,
  extractComponentSourcePath,
  extractDirectValueSource,
} from './text-expression';
import {
  adaptDependencySourceResolver,
  type SxDependencySourceResolver,
  type SxReactiveSourceResolver,
} from './source-resolution';
import {
  MARKER_ATTRIBUTE,
  MIXED_STATE_REASON,
  angularOwnedReadError,
} from './structural-lowering';

export type { SxSourceSpan } from './binding-plan';

export interface SxTemplateBinding {
  readonly kind: SxBindingKind;
  readonly node: string;
  readonly source: string;
  readonly name?: string;
  readonly dependencies?: readonly string[];
  /** Angular event modifiers (`stop`, `prevent`, `enter`, …). */
  readonly modifiers?: readonly string[];
  readonly span: SxSourceSpan;
}

/**
 * Element-only path from the component host.
 *
 * Each number is an index into `Element.children`, intentionally ignoring text
 * and comment nodes. This makes paths insensitive to template whitespace.
 */
export type SxElementPath = readonly number[];

export interface SxTemplateEdit extends SxSourceSpan {
  readonly replacement: string;
}

export interface ParseSxTemplateOptions {
  /**
   * Compile-time source classifier supplied by the component TypeScript build
   * adapter. Runtime duck typing is intentionally not used.
   */
  readonly resolveReactiveSource?: SxReactiveSourceResolver;
  /** @deprecated Prefer `resolveReactiveSource`. */
  readonly isDependencySource?: SxDependencySourceResolver;
}

export interface ParsedSxTemplate {
  readonly plan: SxBindingPlan;
  /** Source ranges recognized as compiler-owned bindings. */
  readonly bindingSpans: readonly SxSourceSpan[];
  /** Explicit sx bindings rewritten to Angular-native SSR/hydration fallbacks. */
  readonly bindingEdits: readonly SxTemplateEdit[];
  readonly nodes: readonly string[];
  readonly nodePaths: Readonly<Record<string, SxElementPath>>;
  /** Lowered structural marker id (its `data-sx-block` value) to node id. */
  readonly markers: Readonly<Record<string, string>>;
}

interface WalkState {
  readonly template: string;
  readonly bindings: SxTemplateBinding[];
  readonly bindingSpans: SxSourceSpan[];
  readonly bindingEdits: SxTemplateEdit[];
  readonly nodes: string[];
  readonly nodePaths: Record<string, number[]>;
  readonly markers: Record<string, string>;
  readonly strict: boolean;
  readonly resolveReactiveSource?: SxReactiveSourceResolver;
  nextNode: number;
}


const SAFE_DOM_PROPERTIES: Readonly<Record<string, string>> = {
  alt: 'alt',
  checked: 'checked',
  className: 'className',
  cols: 'cols',
  colSpan: 'colSpan',
  colspan: 'colSpan',
  contentEditable: 'contentEditable',
  disabled: 'disabled',
  draggable: 'draggable',
  height: 'height',
  hidden: 'hidden',
  htmlFor: 'htmlFor',
  id: 'id',
  max: 'max',
  min: 'min',
  multiple: 'multiple',
  name: 'name',
  open: 'open',
  placeholder: 'placeholder',
  readOnly: 'readOnly',
  readonly: 'readOnly',
  required: 'required',
  rows: 'rows',
  rowSpan: 'rowSpan',
  rowspan: 'rowSpan',
  selected: 'selected',
  spellcheck: 'spellcheck',
  step: 'step',
  tabIndex: 'tabIndex',
  tabindex: 'tabIndex',
  textContent: 'textContent',
  title: 'title',
  type: 'type',
  value: 'value',
  width: 'width',
};

// Auto-lowering must not bypass Angular's sanitizer. URL/resource/HTML
// properties (href/src/innerHTML/etc.) deliberately do not appear above.
const SAFE_AUTO_ATTRIBUTES = new Set([
  'role',
  'title',
  'tabindex',
]);

const SAFE_AUTO_STYLES = new Set([
  'display',
  'height',
  'opacity',
  'transform',
  'visibility',
  'width',
]);


const DYNAMIC_TOPOLOGY_ERROR =
  'Direct sx bindings require a static element topology: Angular ' +
  'structural/template blocks, structural directives (*ngIf), and content ' +
  'projection are not yet supported by the static-node compiler. Compile ' +
  'dynamic structure with the sx structural compiler stage.';

/**
 * Parses an Angular template and extracts Streamix-owned bindings.
 *
 * The compiler recognizes:
 *
 * - interpolation reading Streamix sources either explicitly through `.value`
 *   or transparently when a compile-time resolver proves the source type;
 * - safe native Angular property/attribute/class/style bindings whose expression
 *   is either `<source>.value` or a compile-time-proven `<source>`.
 *
 * Pure Streamix expressions are emitted as direct bindings while Angular gets
 * an SSR/hydration `.value` fallback. Hybrid text expressions stay Angular-owned
 * and receive Streamix-driven local view invalidation. Security-sensitive sinks
 * stay Angular-owned so Angular sanitization remains in the path.
 */
export function parseSxTemplate(
  template: string,
  templateUrl = 'inline-template.html',
  options: ParseSxTemplateOptions = {},
): ParsedSxTemplate {
  const parsed = parseTemplate(template, templateUrl, {
    preserveWhitespaces: true,
  });

  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map(error => error.toString()).join('\n'));
  }

  const resolveReactiveSource = options.resolveReactiveSource ??
    adaptDependencySourceResolver(options.isDependencySource);

  const state: WalkState = {
    template,
    bindings: [],
    bindingSpans: [],
    bindingEdits: [],
    nodes: [],
    nodePaths: {},
    markers: {},
    strict: containsCompiledBinding(
      parsed.nodes,
      template,
      resolveReactiveSource,
    ),
    resolveReactiveSource,
    nextNode: 0,
  };

  walkStaticChildren(parsed.nodes, state, []);

  return {
    plan: createBindingPlan(state.bindings),
    bindingSpans: state.bindingSpans,
    bindingEdits: state.bindingEdits,
    nodes: state.nodes,
    nodePaths: state.nodePaths,
    markers: state.markers,
  };
}

function walkStaticChildren(
  nodes: readonly TmplAstNode[],
  state: WalkState,
  parentPath: readonly number[],
): void {
  let elementIndex = 0;
  const siblings = flattenTransparentContainers(nodes);

  for (let index = 0; index < siblings.length; index += 1) {
    const node = siblings[index];

    if (node instanceof TmplAstElement) {
      const path = [...parentPath, elementIndex++];
      visitElement(node, state, path);
      walkStaticChildren(node.children, state, path);
      continue;
    }

    if (state.strict && !isInertText(node)) {
      // A structural block or projected content renders a variable number of
      // element children, so a compiled binding on any following sibling (or
      // in its subtree) would be addressed by a path that shifts whenever the
      // dynamic region renders. containsCompiledBinding deliberately skips
      // dynamic-node interiors, so bindings owned by the Angular control-flow
      // lowering do not trip this guard.
      if (
        shiftsElementTopology(node) &&
        siblings
          .slice(index + 1)
          .some(sibling =>
            containsCompiledBinding(
              sibling,
              state.template,
              state.resolveReactiveSource,
            ),
          )
      ) {
        throw new Error(DYNAMIC_TOPOLOGY_ERROR);
      }

      if (
        containsCompiledBinding(node, state.template, state.resolveReactiveSource)
      ) {
        throw new Error(DYNAMIC_TOPOLOGY_ERROR);
      }
    }

  }
}





/**
 * Nodes whose rendered content joins the sibling element sequence at runtime,
 * shifting the element indices the static path compiler computes.
 */
function shiftsElementTopology(node: TmplAstNode): boolean {
  return isAngularDynamicNode(node) || node instanceof TmplAstContent;
}

/**
 * `ng-container` renders no element: its children join the parent's element
 * sequence, so they are spliced into the sibling list before paths are
 * computed.
 */
function flattenTransparentContainers(
  nodes: readonly TmplAstNode[],
): TmplAstNode[] {
  const flattened: TmplAstNode[] = [];

  for (const node of nodes) {
    if (node instanceof TmplAstElement && node.name === 'ng-container') {
      flattened.push(...flattenTransparentContainers(node.children));
    } else {
      flattened.push(node);
    }
  }

  return flattened;
}

/** Text-only nodes never appear in `Element.children`, so they are inert. */
function isInertText(node: TmplAstNode): boolean {
  return node instanceof TmplAstText || node instanceof TmplAstBoundText;
}

function visitElement(
  element: TmplAstElement,
  state: WalkState,
  path: readonly number[],
): void {
  const nodeId = `node${state.nextNode++}`;
  state.nodes.push(nodeId);
  state.nodePaths[nodeId] = [...path];

  const marker = element.attributes.find(
    attribute => attribute.name === MARKER_ATTRIBUTE,
  );

  if (marker) {
    state.markers[marker.value] = nodeId;
  }

  let hasExplicitTextBinding = false;

  for (const input of element.inputs) {
    const raw = sourceText(state.template, input.sourceSpan);
    const publicName = extractPublicBindingName(raw);

    if (!publicName) {
      continue;
    }

    const expression = extractBindingExpression(raw);
    const span = {
      start: input.sourceSpan.start.offset,
      end: input.sourceSpan.end.offset,
    };

    if (publicName.startsWith('sx.')) {
      throw new Error(
        `Unsupported legacy Streamix binding ${JSON.stringify(publicName)}. ` +
        'Use the equivalent standard Angular binding instead.',
      );
    }

    // Native Angular bindings can be authored either as `<source>.value` or,
    // when the TypeScript-aware build adapter proves the path is a
    // DependencySource, transparently as `<source>`.
    const explicitSource = extractDirectValueSource(expression);
    const transparentPath = !explicitSource
      ? extractComponentSourcePath(expression)
      : undefined;
    const transparentSource = transparentPath &&
      state.resolveReactiveSource?.(transparentPath);
    const source = explicitSource ?? transparentSource;

    if (!source) {
      // An expression the compiler cannot prove: silent when it reads no
      // Streamix value, compiled when every read is reactive, and a build
      // error when it mixes reactive reads with state Angular evaluates on
      // its own.
      const analysis = analyzeSxExpression(
        expression,
        state.resolveReactiveSource,
      );

      if (!analysis) {
        continue;
      }

      if (analysis.mode === 'unsupported') {
        throw new Error(
          angularOwnedReadError(
            analysis.dependencies[0] ?? expression,
            MIXED_STATE_REASON,
          ),
        );
      }

      const expressionBinding = classifyExpressionBinding(
        publicName,
        nodeId,
        expression,
        state.resolveReactiveSource,
      );

      if (!expressionBinding) {
        throw new Error(
          angularOwnedReadError(analysis.dependencies[0] ?? expression),
        );
      }

      // Angular renders the SSR/hydration value from the same expression;
      // the compiled binding owns the DOM once installed.
      state.bindingEdits.push({
        ...span,
        replacement: angularFallbackForExpression(
          publicName,
          analysis.expression,
        ),
      });

      state.bindings.push({ ...expressionBinding, span });
      state.bindingSpans.push(span);
      continue;
    }

    const binding = classifyNativeAngularBinding(publicName, nodeId, source);

    if (transparentSource) {
      if (binding) {
        if (!isScopeBackingSource(transparentSource)) {
          // The direct binding owns the DOM; Angular's fallback read only has
          // to render the correct server/hydration value.
          state.bindingEdits.push({
            ...span,
            replacement: angularFallbackForNativeBinding(publicName, source),
          });
        }
      } else {
        // Angular evaluates this input itself: a directive/component input
        // (`ngSwitch`, `[item]`, …) or a sanitizer-sensitive sink.
        throw new Error(angularOwnedReadError(transparentPath!));
      }
    }

    if (!binding) {
      continue;
    }

    state.bindings.push({ ...binding, span });
    state.bindingSpans.push(span);
  }

  for (const output of element.outputs) {
    const binding = classifyEventBinding(
      element,
      output,
      nodeId,
      state.template,
    );

    if (!binding) {
      continue;
    }

    const span = {
      start: output.sourceSpan.start.offset,
      end: output.sourceSpan.end.offset,
    };

    // The compiled listener replaces Angular's binding entirely: leaving both
    // in place would run the handler twice.
    state.bindingEdits.push({ ...span, replacement: '' });
    state.bindings.push({ ...binding, span });
    state.bindingSpans.push(span);
  }

  // Automatic text lowering is limited to a sole interpolation. The generated
  // direct binding updates Angular's existing Text node, preserving hydration
  // identity. Mixed text/child-node content stays Angular-owned.
  if (!hasExplicitTextBinding && element.children.length === 1) {
    const child = element.children[0];

    if (child instanceof TmplAstBoundText) {
      const raw = sourceText(state.template, child.sourceSpan);
      const analysis = analyzeSxTextInterpolation(
        raw,
        state.resolveReactiveSource,
      );

      if (analysis) {
        // An expression that mixes reactive reads with component state cannot
        // be bound and cannot be left to Angular without going stale.
        if (analysis.mode === 'unsupported') {
          throw new Error(
            angularOwnedReadError(
              analysis.dependencies[0] ?? analysis.expression,
              MIXED_STATE_REASON,
            ),
          );
        }

        const span = {
          start: child.sourceSpan.start.offset,
          end: child.sourceSpan.end.offset,
        };

        if (analysis.sourceTransparent) {
          state.bindingEdits.push({
            ...span,
            replacement: `{{ ${analysis.expression} }}`,
          });
        }

        if (analysis.mode === 'direct') {
          state.bindings.push({
            kind: 'text-node',
            node: nodeId,
            source: analysis.directSource!,
            span,
          });
          state.bindingSpans.push(span);
        } else {
          state.bindings.push({
            kind: 'text-expression-node',
            node: nodeId,
            source: analysis.expression,
            dependencies: analysis.dependencies,
            span,
          });
          state.bindingSpans.push(span);
        }
      }
    }
  }
}

function isScopeBackingSource(source: string): boolean {
  return source.includes('.get(');
}

/**
 * Deep compiled-binding detection. Structural blocks store children in
 * version-specific shapes, so this walks object values generically instead of
 * enumerating Angular node classes that change across versions.
 */
function containsCompiledBinding(
  node: unknown,
  template: string,
  resolveReactiveSource?: SxReactiveSourceResolver,
): boolean {
  if (Array.isArray(node)) {
    return node.some(child =>
      containsCompiledBinding(child, template, resolveReactiveSource)
    );
  }

  if (!node || typeof node !== 'object') {
    return false;
  }

  if (isAngularDynamicNode(node)) {
    return false;
  }

  if (node instanceof TmplAstElement) {
    let hasExplicitTextBinding = false;

    for (const output of node.outputs) {
      if (classifyEventBinding(node, output, 'node', template)) {
        return true;
      }
    }

    for (const input of node.inputs) {
      const raw = sourceText(template, input.sourceSpan);
      const publicName = extractPublicBindingName(raw);

      if (!publicName) {
        continue;
      }

      if (publicName.startsWith('sx.')) {
        hasExplicitTextBinding ||= publicName === 'sx.text';
        return true;
      }

      const expression = tryExtractBindingExpression(raw);
      if (expression) {
        const explicitSource = extractDirectValueSource(expression);
        const transparentPath = !explicitSource
          ? extractComponentSourcePath(expression)
          : undefined;
        const source = explicitSource ?? (
          transparentPath
            ? resolveReactiveSource?.(transparentPath)
            : undefined
        );

        if (
          source
            ? classifyNativeAngularBinding(publicName, 'node', source)
            : classifyExpressionBinding(
                publicName,
                'node',
                expression,
                resolveReactiveSource,
              )
        ) {
          return true;
        }
      }
    }

    if (!hasExplicitTextBinding && node.children.length === 1) {
      const child = node.children[0];
      if (child instanceof TmplAstBoundText) {
        const raw = sourceText(template, child.sourceSpan);
        if (analyzeSxTextInterpolation(raw, resolveReactiveSource)) {
          return true;
        }
      }
    }
  }

  const record = node as Record<string, unknown>;
  return Object.values(record).some(
    value => value !== (record as { inputs?: unknown }).inputs &&
      containsCompiledBinding(value, template, resolveReactiveSource),
  );
}

function sourceText(template: string, span: ParseSourceSpan): string {
  return template.slice(span.start.offset, span.end.offset);
}

function extractBindingExpression(source: string): string {
  const expression = tryExtractBindingExpression(source);

  if (expression === undefined) {
    throw new Error(
      `Unable to read binding expression from ${JSON.stringify(source)}.`,
    );
  }

  return expression;
}

function tryExtractBindingExpression(source: string): string | undefined {
  const match = /^\s*\[[^\]]+\]\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/.exec(
    source,
  );

  const expression = match?.[1] ?? match?.[2];
  return expression?.trim();
}

function extractPublicBindingName(source: string): string | undefined {
  const match = /^\s*\[([^\]]+)\]\s*=/.exec(source);
  return match?.[1]?.trim();
}

function angularFallbackForNativeBinding(
  publicName: string,
  source: string,
): string {
  return `[${publicName}]=\"${source}.value\"`;
}

/**
 * SSR fallback for a compiled expression binding. The normalized expression
 * already reads `value` from every reactive source, so Angular renders the
 * server value and hydration agrees with the compiled DOM.
 */
function angularFallbackForExpression(
  publicName: string,
  expression: string,
): string {
  return `[${publicName}]=\"${expression}\"`;
}



/**
 * Maps simple Angular native binding syntax to the equivalent direct sx kind.
 *
 * Unit-qualified styles (`[style.width.px]`) intentionally remain Angular-owned
 * because direct `sx.style.*` currently writes the provided value verbatim.
 */
function classifyExpressionBinding(
  publicName: string,
  node: string,
  expression: string,
  resolveReactiveSource?: SxReactiveSourceResolver,
): Omit<SxTemplateBinding, 'span'> | undefined {
  const analysis = analyzeSxExpression(expression, resolveReactiveSource);

  if (!analysis || analysis.mode !== 'expression') {
    return undefined;
  }

  const base = classifyNativeAngularBinding(
    publicName,
    node,
    analysis.expression,
  );

  if (!base) {
    return undefined;
  }

  return {
    ...base,
    kind: EXPRESSION_BINDING_KINDS[base.kind] ?? base.kind,
    dependencies: analysis.dependencies,
  };
}

/** Expression forms of the native binding kinds. */
const EXPRESSION_BINDING_KINDS: Partial<Record<SxBindingKind, SxBindingKind>> = {
  property: 'property-expression',
  attribute: 'attribute-expression',
  class: 'class-expression',
  style: 'style-expression',
};

function classifyNativeAngularBinding(
  publicName: string,
  node: string,
  source: string,
): Omit<SxTemplateBinding, 'span'> | undefined {
  if (publicName.startsWith('attr.')) {
    const name = publicName.slice('attr.'.length);
    const normalized = name.toLowerCase();
    const safe = normalized.startsWith('aria-') ||
      normalized.startsWith('data-') ||
      SAFE_AUTO_ATTRIBUTES.has(normalized);
    return name && safe
      ? { kind: 'attribute', node, source, name }
      : undefined;
  }

  if (publicName.startsWith('class.')) {
    const name = publicName.slice('class.'.length);
    return name && !name.includes('.')
      ? { kind: 'class', node, source, name }
      : undefined;
  }

  if (publicName.startsWith('style.')) {
    const name = publicName.slice('style.'.length);
    return name && !name.includes('.') && SAFE_AUTO_STYLES.has(name.toLowerCase())
      ? { kind: 'style', node, source, name }
      : undefined;
  }

  // Angular gives `[class]` and `[style]` special merge semantics, so do not
  // reinterpret them as ordinary DOM properties.
  if (
    !publicName ||
    publicName === 'class' ||
    publicName === 'style' ||
    publicName.startsWith('@') ||
    publicName.includes('.') ||
    publicName.includes('(') ||
    publicName.includes(')')
  ) {
    return undefined;
  }

  // A plain Angular `[name]` may be a directive/component input rather than a
  // DOM property. Only auto-lower names with unambiguous native DOM semantics;
  // arbitrary properties remain Angular-owned.
  const property = SAFE_DOM_PROPERTIES[publicName];
  return property
    ? { kind: 'property', node, source, name: property }
    : undefined;
}

/**
 * A `(event)="handler(...)"` binding the compiler installs directly.
 *
 * The handler must be a method call with literal arguments: it runs
 * imperatively at dispatch time, so a handler that reads Streamix state reads
 * the current value rather than needing a binding.
 */
export function classifyEventBinding(
  element: TmplAstElement,
  output: TmplAstBoundEvent,
  nodeId: string,
  template: string,
): Omit<SxTemplateBinding, 'span'> | undefined {
  const parsed = parseNativeEventBinding(
    element.name,
    output.name,
    output.phase,
    output.target,
    sourceText(template, output.handlerSpan),
  );

  if (!parsed) {
    return undefined;
  }

  return {
    kind: 'event',
    node: nodeId,
    source: `${parsed.method}(${parsed.argumentText})`,
    name: parsed.type,
    modifiers: parsed.modifiers.length > 0 ? parsed.modifiers : undefined,
  };
}

function isAngularDynamicNode(node: object): boolean {
  const name = (node as { constructor?: { name?: string } }).constructor?.name;
  return name === 'Template' ||
    name === 'IfBlock' ||
    name === 'ForLoopBlock' ||
    name === 'SwitchBlock' ||
    name === 'DeferredBlock';
}
