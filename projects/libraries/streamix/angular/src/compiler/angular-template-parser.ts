import {
  TmplAstBoundText,
  TmplAstElement,
  TmplAstText,
  parseTemplate,
  type ParseSourceSpan,
  type TmplAstNode,
} from '@angular/compiler';

import {
  createBindingPlan,
  type SxBindingKind,
  type SxBindingPlan,
  type SxSourceSpan,
} from './binding-plan';
import {
  analyzeSxTextInterpolation,
  extractComponentSourcePath,
  extractDirectValueSource,
} from './text-expression';
import type { SxDependencySourceResolver } from './source-resolution';

export type { SxSourceSpan } from './binding-plan';

export interface SxTemplateBinding {
  readonly kind: SxBindingKind;
  readonly node: string;
  readonly source: string;
  readonly name?: string;
  readonly dependencies?: readonly string[];
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
}

interface WalkState {
  readonly template: string;
  readonly bindings: SxTemplateBinding[];
  readonly bindingSpans: SxSourceSpan[];
  readonly bindingEdits: SxTemplateEdit[];
  readonly nodes: string[];
  readonly nodePaths: Record<string, number[]>;
  readonly strict: boolean;
  readonly isDependencySource?: SxDependencySourceResolver;
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
  'visibility',
  'width',
]);

const SECURITY_SENSITIVE_PROPERTIES = new Set([
  'action',
  'formAction',
  'href',
  'innerHTML',
  'outerHTML',
  'src',
  'srcdoc',
]);

const SECURITY_SENSITIVE_ATTRIBUTES = new Set([
  'action',
  'formaction',
  'href',
  'src',
  'srcdoc',
  'srcset',
  'style',
]);

const SECURITY_SENSITIVE_STYLES = new Set([
  'background',
  'background-image',
  'clip-path',
  'cursor',
  'filter',
  'list-style',
  'list-style-image',
  'mask',
  'mask-image',
]);

const DYNAMIC_TOPOLOGY_ERROR =
  'Direct sx bindings require a static element topology: Angular ' +
  'structural/template blocks, structural directives (*ngIf), and content ' +
  'projection are not yet supported by the static-node compiler. Compile ' +
  'dynamic structure with the sx structural compiler stage.';

/**
 * Parses an Angular template and extracts Streamix-owned bindings.
 *
 * In addition to explicit `[sx.*]` bindings, the compiler recognizes:
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

  const state: WalkState = {
    template,
    bindings: [],
    bindingSpans: [],
    bindingEdits: [],
    nodes: [],
    nodePaths: {},
    strict: containsCompiledBinding(
      parsed.nodes,
      template,
      options.isDependencySource,
    ),
    isDependencySource: options.isDependencySource,
    nextNode: 0,
  };

  walkStaticChildren(parsed.nodes, state, []);

  return {
    plan: createBindingPlan(state.bindings),
    bindingSpans: state.bindingSpans,
    bindingEdits: state.bindingEdits,
    nodes: state.nodes,
    nodePaths: state.nodePaths,
  };
}

function walkStaticChildren(
  nodes: readonly TmplAstNode[],
  state: WalkState,
  parentPath: readonly number[],
): void {
  let elementIndex = 0;

  for (const node of flattenTransparentContainers(nodes)) {
    if (node instanceof TmplAstElement) {
      const path = [...parentPath, elementIndex++];
      visitElement(node, state, path);
      walkStaticChildren(node.children, state, path);
      continue;
    }

    if (state.strict && !isInertText(node)) {
      throw new Error(DYNAMIC_TOPOLOGY_ERROR);
    }
  }
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
      assertDependencySourceExpression(expression, publicName);

      const binding = classifySxBinding(publicName, nodeId, expression);
      if (!binding) {
        continue;
      }

      state.bindings.push({ ...binding, span });
      state.bindingSpans.push(span);
      state.bindingEdits.push({
        ...span,
        replacement: angularFallbackForSxBinding(publicName, expression),
      });
      hasExplicitTextBinding ||= binding.kind === 'text';
      continue;
    }

    // Native Angular bindings can be authored either as `<source>.value` or,
    // when the TypeScript-aware build adapter proves the path is a
    // DependencySource, transparently as `<source>`. Compound native
    // expressions remain Angular-owned.
    const explicitSource = extractDirectValueSource(expression);
    const transparentPath = !explicitSource
      ? extractComponentSourcePath(expression)
      : undefined;
    const transparentSource = transparentPath &&
      state.isDependencySource?.(transparentPath)
        ? transparentPath
        : undefined;
    const source = explicitSource ?? transparentSource;

    if (!source) {
      continue;
    }

    const binding = classifyNativeAngularBinding(publicName, nodeId, source);

    if (transparentSource && (binding || isNativeAngularValueSink(publicName))) {
      // Source transparency still unwraps sanitizer-sensitive native sinks, but
      // those sinks remain Angular-owned so Angular performs sanitization.
      state.bindingEdits.push({
        ...span,
        replacement: angularFallbackForNativeBinding(publicName, source),
      });
    }

    if (!binding) {
      continue;
    }

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
        state.isDependencySource,
      );

      if (analysis) {
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
        } else if (analysis.mode === 'expression') {
          state.bindings.push({
            kind: 'text-expression-node',
            node: nodeId,
            source: analysis.expression,
            dependencies: analysis.dependencies,
            span,
          });
          state.bindingSpans.push(span);
        } else {
          // Hybrid expression: Angular keeps and evaluates the interpolation;
          // Streamix only subscribes to `.value` dependencies and invalidates
          // this component view when any of them emit.
          state.bindings.push({
            kind: 'angular-invalidate',
            node: nodeId,
            source: analysis.expression,
            dependencies: analysis.dependencies,
            span,
          });
        }
      }
    }
  }
}

/**
 * Deep compiled-binding detection. Structural blocks store children in
 * version-specific shapes, so this walks object values generically instead of
 * enumerating Angular node classes that change across versions.
 */
function containsCompiledBinding(
  node: unknown,
  template: string,
  isDependencySource?: SxDependencySourceResolver,
): boolean {
  if (Array.isArray(node)) {
    return node.some(child =>
      containsCompiledBinding(child, template, isDependencySource)
    );
  }

  if (!node || typeof node !== 'object') {
    return false;
  }

  if (node instanceof TmplAstElement) {
    let hasExplicitTextBinding = false;

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
          transparentPath && isDependencySource?.(transparentPath)
            ? transparentPath
            : undefined
        );

        if (
          source &&
          classifyNativeAngularBinding(publicName, 'node', source)
        ) {
          return true;
        }
      }
    }

    if (!hasExplicitTextBinding && node.children.length === 1) {
      const child = node.children[0];
      if (child instanceof TmplAstBoundText) {
        const raw = sourceText(template, child.sourceSpan);
        if (analyzeSxTextInterpolation(raw, isDependencySource)) {
          return true;
        }
      }
    }
  }

  const record = node as Record<string, unknown>;
  return Object.values(record).some(
    value => value !== (record as { inputs?: unknown }).inputs &&
      containsCompiledBinding(value, template, isDependencySource),
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

function assertDependencySourceExpression(
  source: string,
  bindingName: string,
): void {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(source)) {
    throw new Error(
      `Unsupported ${bindingName} source expression: ${JSON.stringify(source)}. ` +
      'Compiled sx bindings currently require a component property path that resolves to a DependencySource.',
    );
  }
}

function angularFallbackForSxBinding(
  publicName: string,
  source: string,
): string {
  const value = `${source}.value`;

  if (publicName === 'sx.text') {
    return `[textContent]="${value}"`;
  }

  if (publicName.startsWith('sx.attr.')) {
    return `[attr.${publicName.slice('sx.attr.'.length)}]="${value}"`;
  }

  if (publicName.startsWith('sx.class.')) {
    return `[class.${publicName.slice('sx.class.'.length)}]="${value}"`;
  }

  if (publicName.startsWith('sx.style.')) {
    return `[style.${publicName.slice('sx.style.'.length)}]="${value}"`;
  }

  return `[${publicName.slice('sx.'.length)}]="${value}"`;
}


function angularFallbackForNativeBinding(
  publicName: string,
  source: string,
): string {
  return `[${publicName}]=\"${source}.value\"`;
}

function classifySxBinding(
  publicName: string,
  node: string,
  source: string,
): Omit<SxTemplateBinding, 'span'> | undefined {
  if (publicName === 'sx.text') {
    return { kind: 'text', node, source };
  }

  if (publicName.startsWith('sx.attr.')) {
    const name = publicName.slice('sx.attr.'.length);
    if (name && SECURITY_SENSITIVE_ATTRIBUTES.has(name.toLowerCase())) {
      throw new Error(
        `Direct ${publicName} bypasses Angular sanitization. Use the native Angular binding instead.`,
      );
    }
    return name ? { kind: 'attribute', node, source, name } : undefined;
  }

  if (publicName.startsWith('sx.class.')) {
    const name = publicName.slice('sx.class.'.length);
    return name ? { kind: 'class', node, source, name } : undefined;
  }

  if (publicName.startsWith('sx.style.')) {
    const name = publicName.slice('sx.style.'.length);
    if (name && SECURITY_SENSITIVE_STYLES.has(name.toLowerCase())) {
      throw new Error(
        `Direct ${publicName} may contain a URL-bearing CSS value and bypass Angular sanitization. Use the native Angular binding instead.`,
      );
    }
    return name ? { kind: 'style', node, source, name } : undefined;
  }

  const name = publicName.slice('sx.'.length);
  if (name && SECURITY_SENSITIVE_PROPERTIES.has(name)) {
    throw new Error(
      `Direct ${publicName} bypasses Angular sanitization. Use the native Angular binding instead.`,
    );
  }
  return name ? { kind: 'property', node, source, name } : undefined;
}

function isNativeAngularValueSink(publicName: string): boolean {
  if (publicName.startsWith('attr.')) {
    return !!publicName.slice('attr.'.length);
  }

  if (publicName.startsWith('class.')) {
    return !!publicName.slice('class.'.length);
  }

  if (publicName.startsWith('style.')) {
    return !!publicName.slice('style.'.length);
  }

  return !!SAFE_DOM_PROPERTIES[publicName] ||
    SECURITY_SENSITIVE_PROPERTIES.has(publicName);
}

/**
 * Maps simple Angular native binding syntax to the equivalent direct sx kind.
 *
 * Unit-qualified styles (`[style.width.px]`) intentionally remain Angular-owned
 * because direct `sx.style.*` currently writes the provided value verbatim.
 */
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
  // arbitrary properties remain available through explicit `[sx.<property>]`.
  const property = SAFE_DOM_PROPERTIES[publicName];
  return property
    ? { kind: 'property', node, source, name: property }
    : undefined;
}
