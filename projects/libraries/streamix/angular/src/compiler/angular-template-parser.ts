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
  extractDirectValueSource,
} from './text-expression';

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

export interface ParsedSxTemplate {
  readonly plan: SxBindingPlan;
  /** Source ranges that are removed from Angular's template after lowering. */
  readonly bindingSpans: readonly SxSourceSpan[];
  readonly nodes: readonly string[];
  readonly nodePaths: Readonly<Record<string, SxElementPath>>;
}

interface WalkState {
  readonly template: string;
  readonly bindings: SxTemplateBinding[];
  readonly bindingSpans: SxSourceSpan[];
  readonly nodes: string[];
  readonly nodePaths: Record<string, number[]>;
  readonly strict: boolean;
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
  href: 'href',
  htmlFor: 'htmlFor',
  id: 'id',
  innerHTML: 'innerHTML',
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
  src: 'src',
  step: 'step',
  tabIndex: 'tabIndex',
  tabindex: 'tabIndex',
  textContent: 'textContent',
  title: 'title',
  type: 'type',
  value: 'value',
  width: 'width',
};

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
 * - a sole interpolation reading one or more Streamix `.value` properties;
 * - native Angular property/attribute/class/unitless-style bindings whose
 *   expression is exactly `<source>.value`.
 *
 * Pure Streamix expressions are removed from Angular's binding graph and
 * emitted as direct bindings. Hybrid text expressions stay in Angular and
 * receive Streamix-driven local view invalidation.
 */
export function parseSxTemplate(
  template: string,
  templateUrl = 'inline-template.html',
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
    nodes: [],
    nodePaths: {},
    strict: containsCompiledBinding(parsed.nodes, template),
    nextNode: 0,
  };

  walkStaticChildren(parsed.nodes, state, []);

  return {
    plan: createBindingPlan(state.bindings),
    bindingSpans: state.bindingSpans,
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
      hasExplicitTextBinding ||= binding.kind === 'text';
      continue;
    }

    // Native Angular bindings are compiler-owned only for the exact
    // `<source>.value` shape. Compound native expressions remain Angular-owned.
    const source = extractDirectValueSource(expression);
    if (!source) {
      continue;
    }

    const binding = classifyNativeAngularBinding(publicName, nodeId, source);
    if (!binding) {
      continue;
    }

    state.bindings.push({ ...binding, span });
    state.bindingSpans.push(span);
  }

  // Direct text rendering targets the element's textContent, so only steal a
  // sole interpolation. Mixed text/child-node content stays Angular-owned.
  if (!hasExplicitTextBinding && element.children.length === 1) {
    const child = element.children[0];

    if (child instanceof TmplAstBoundText) {
      const raw = sourceText(state.template, child.sourceSpan);
      const analysis = analyzeSxTextInterpolation(raw);

      if (analysis) {
        const span = {
          start: child.sourceSpan.start.offset,
          end: child.sourceSpan.end.offset,
        };

        if (analysis.mode === 'direct') {
          state.bindings.push({
            kind: 'text',
            node: nodeId,
            source: analysis.directSource!,
            span,
          });
          state.bindingSpans.push(span);
        } else if (analysis.mode === 'expression') {
          state.bindings.push({
            kind: 'text-expression',
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
function containsCompiledBinding(node: unknown, template: string): boolean {
  if (Array.isArray(node)) {
    return node.some(child => containsCompiledBinding(child, template));
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
      if (
        expression &&
        extractDirectValueSource(expression) &&
        classifyNativeAngularBinding(publicName, 'node', 'source')
      ) {
        return true;
      }
    }

    if (!hasExplicitTextBinding && node.children.length === 1) {
      const child = node.children[0];
      if (child instanceof TmplAstBoundText) {
        const raw = sourceText(template, child.sourceSpan);
        if (analyzeSxTextInterpolation(raw)) {
          return true;
        }
      }
    }
  }

  const record = node as Record<string, unknown>;
  return Object.values(record).some(
    value => value !== (record as { inputs?: unknown }).inputs &&
      containsCompiledBinding(value, template),
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
    return name ? { kind: 'attribute', node, source, name } : undefined;
  }

  if (publicName.startsWith('sx.class.')) {
    const name = publicName.slice('sx.class.'.length);
    return name ? { kind: 'class', node, source, name } : undefined;
  }

  if (publicName.startsWith('sx.style.')) {
    const name = publicName.slice('sx.style.'.length);
    return name ? { kind: 'style', node, source, name } : undefined;
  }

  const name = publicName.slice('sx.'.length);
  return name ? { kind: 'property', node, source, name } : undefined;
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
    return name ? { kind: 'attribute', node, source, name } : undefined;
  }

  if (publicName.startsWith('class.')) {
    const name = publicName.slice('class.'.length);
    return name && !name.includes('.')
      ? { kind: 'class', node, source, name }
      : undefined;
  }

  if (publicName.startsWith('style.')) {
    const name = publicName.slice('style.'.length);
    return name && !name.includes('.')
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
