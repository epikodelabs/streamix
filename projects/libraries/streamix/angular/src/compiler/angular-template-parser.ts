import {
  TmplAstElement,
  TmplAstTemplate,
  parseTemplate,
  type ParseSourceSpan,
  type TmplAstNode,
} from '@angular/compiler';

import {
  createBindingPlan,
  type SxBindingKind,
  type SxBindingPlan,
} from './binding-plan';

export interface SxTemplateBinding {
  readonly kind: SxBindingKind;
  readonly node: string;
  readonly source: string;
  readonly name?: string;
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
  readonly nodes: readonly string[];
  readonly nodePaths: Readonly<Record<string, SxElementPath>>;
}

interface WalkState {
  readonly template: string;
  readonly bindings: SxTemplateBinding[];
  readonly nodes: string[];
  readonly nodePaths: Record<string, number[]>;
  nextNode: number;
}

/**
 * Parses an Angular template and extracts Streamix `sx` bindings.
 *
 * Direct node acquisition currently requires a static element topology.
 * `sx` bindings nested under Angular structural/template nodes are rejected so
 * generated code never relies on an unstable DOM path. Structural sx lowering
 * is a separate compiler stage.
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

  assertStaticSxTopology(template);

  const state: WalkState = {
    template,
    bindings: [],
    nodes: [],
    nodePaths: {},
    nextNode: 0,
  };

  walkStaticChildren(parsed.nodes, state, []);

  return {
    plan: createBindingPlan(state.bindings),
    nodes: state.nodes,
    nodePaths: state.nodePaths,
  };
}

function assertStaticSxTopology(template: string): void {
  if (!/\[sx\.[^\]]+\]/.test(template)) {
    return;
  }

  // Angular 17+ built-in control flow is represented by dedicated AST node
  // classes (for example TmplAstIfBlock), not TmplAstTemplate. Direct sx
  // bindings currently use compile-time Element.children paths, so any
  // dynamic topology in the same template can invalidate those paths.
  if (/@(if|for|switch|defer)\b/.test(template)) {
    throw new Error(
      'Direct sx bindings inside templates with Angular structural/template blocks are not yet supported by the static-node compiler. Compile dynamic structure with the sx structural compiler stage.',
    );
  }
}

function walkStaticChildren(
  nodes: readonly TmplAstNode[],
  state: WalkState,
  parentPath: readonly number[],
): void {
  let elementIndex = 0;

  for (const node of nodes) {
    if (node instanceof TmplAstElement) {
      const path = [...parentPath, elementIndex++];
      visitElement(node, state, path);
      walkStaticChildren(node.children, state, path);
      continue;
    }

    if (node instanceof TmplAstTemplate) {
      if (containsSxBinding(node.children, state.template)) {
        throw new Error(
          'Direct sx bindings inside structural/template blocks are not yet supported by the static-node compiler. Compile the structural block with sxAtom in the structural compiler stage.',
        );
      }
    }
  }
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
      state.bindings.push(binding);
    }
  }
}

function containsSxBinding(
  nodes: readonly TmplAstNode[],
  template: string,
): boolean {
  for (const node of nodes) {
    if (node instanceof TmplAstElement) {
      for (const input of node.inputs) {
        const raw = sourceText(template, input.sourceSpan);
        if (extractPublicBindingName(raw)?.startsWith('sx.')) {
          return true;
        }
      }

      if (containsSxBinding(node.children, template)) {
        return true;
      }
    } else if (
      node instanceof TmplAstTemplate &&
      containsSxBinding(node.children, template)
    ) {
      return true;
    }
  }

  return false;
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
): SxTemplateBinding | undefined {
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
