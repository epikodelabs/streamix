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

export type { SxSourceSpan } from './binding-plan';

export interface SxTemplateBinding {
  readonly kind: SxBindingKind;
  readonly node: string;
  readonly source: string;
  readonly name?: string;
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

const DYNAMIC_TOPOLOGY_ERROR =
  'Direct sx bindings require a static element topology: Angular ' +
  'structural/template blocks, structural directives (*ngIf), and content ' +
  'projection are not yet supported by the static-node compiler. Compile ' +
  'dynamic structure with the sx structural compiler stage.';

/**
 * Parses an Angular template and extracts Streamix `sx` bindings.
 *
 * Direct node acquisition currently requires a static element topology.
 * Any dynamic topology in the same template — structural directives, built-in
 * control-flow blocks, content projection — can shift `Element.children`
 * indices, so it is rejected at the AST level rather than parsed into
 * silently wrong paths. Structural sx lowering is a separate compiler stage.
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
    strict: containsSxBinding(parsed.nodes, template),
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

    // Anything that is not a plain element or inert text — structural
    // directives, built-in control-flow blocks, content projection, and any
    // node class this compiler does not know — can change the runtime element
    // topology. Reject it instead of walking past a wrong path.
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

  for (const input of element.inputs) {
    const raw = sourceText(state.template, input.sourceSpan);
    const publicName = extractPublicBindingName(raw);

    if (!publicName?.startsWith('sx.')) {
      continue;
    }

    const source = extractBindingExpression(raw);
    assertDependencySourceExpression(source, publicName);

    const binding = classifyBinding(
      publicName,
      nodeId,
      source,
    );

    if (binding) {
      const span = {
        start: input.sourceSpan.start.offset,
        end: input.sourceSpan.end.offset,
      };

      state.bindings.push({ ...binding, span });
      state.bindingSpans.push(span);
    }
  }
}

/**
 * Deep sx-binding detection. Structural blocks (`@if` branches, `@for`
 * bodies, `@switch` cases) store their children in version-specific shapes,
 * so this walks object values generically instead of enumerating node
 * classes that change across Angular versions.
 */
function containsSxBinding(node: unknown, template: string): boolean {
  if (Array.isArray(node)) {
    return node.some(child => containsSxBinding(child, template));
  }

  if (!node || typeof node !== 'object') {
    return false;
  }

  const record = node as {
    inputs?: readonly { sourceSpan: ParseSourceSpan }[];
  };

  for (const input of record.inputs ?? []) {
    const raw = sourceText(template, input.sourceSpan);
    if (extractPublicBindingName(raw)?.startsWith('sx.')) {
      return true;
    }
  }

  return Object.values(record).some(
    value => value !== record.inputs && containsSxBinding(value, template),
  );
}

function sourceText(template: string, span: ParseSourceSpan): string {
  return template.slice(span.start.offset, span.end.offset);
}

function extractBindingExpression(source: string): string {
  const match = /^\s*\[[^\]]+\]\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/.exec(
    source,
  );

  const expression = match?.[1] ?? match?.[2];

  if (expression === undefined) {
    throw new Error(
      `Unable to read sx binding expression from ${JSON.stringify(source)}.`,
    );
  }

  return expression.trim();
}

function extractPublicBindingName(source: string): string | undefined {
  const match = /^\s*\[([^\]]+)\]\s*=/.exec(source);
  return match?.[1]?.trim();
}

function assertDependencySourceExpression(
  source: string,
  bindingName: string,
): void {
  if (
    !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(source)
  ) {
    throw new Error(
      `Unsupported ${bindingName} source expression: ${JSON.stringify(source)}. ` +
      'Compiled sx bindings currently require a component property path that resolves to a DependencySource.',
    );
  }
}

function classifyBinding(
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
