import {
  TmplAstBoundText,
  TmplAstElement,
  TmplAstText,
  parseTemplate,
  type TmplAstNode,
} from '@angular/compiler';

import type { SxReactiveSourceResolver } from './source-resolution';
import { analyzeSxExpression } from './text-expression';

export interface SxCompiledBlockBinding {
  readonly node: string;
  readonly source: string;
  /** Present when the interpolation is a compiled compound expression. */
  readonly dependencies?: readonly string[];
}

export interface SxCompiledBlockTemplate {
  readonly createBody: string;
  readonly updateBody: string;
  readonly rootNodes: readonly string[];
  readonly bindingCount: number;
  /**
   * Binding-table slots for interpolations whose expressions resolve to
   * reactive sources. Empty for the context-based `*sx` compilation mode.
   */
  readonly bindings: readonly SxCompiledBlockBinding[];
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
  readonly resolveReactiveSource?: SxReactiveSourceResolver;
  readonly allowLocals: boolean;
  nextNode: number;
  bindingCount: number;
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

  const state: EmitState = {
    template,
    document: options.documentExpression ?? 'document',
    create: [],
    updates: [],
    roots: [],
    bindings: [],
    resolveReactiveSource: options.resolveReactiveSource,
    allowLocals: options.allowLocals === true,
    nextNode: 0,
    bindingCount: 0,
  };

  for (const node of parsed.nodes) {
    state.roots.push(...emitNode(node, state));
  }

  return {
    createBody: state.create.join('\n'),
    updateBody: state.updates.join('\n'),
    rootNodes: state.roots,
    bindingCount: state.bindingCount,
    bindings: state.bindings,
  };
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

  const type = node.constructor?.name ?? 'unknown';
  throw new Error(
    `Unsupported sx structural template node: ${type}. ` +
    'The direct structural compiler currently supports static elements, static attributes, text, and simple interpolations.',
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

    const source = state.resolveReactiveSource?.(part.value);

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

    // Anything left is a loop-local read, resolved against the collection
    // context at update time. Only plain property paths can be resolved.
    if (!LOCAL_READ.test(part.value)) {
      throw new Error(
        `Unsupported sx structural interpolation: ${JSON.stringify(part.value)}. ` +
        'Only local/property reads are supported in the direct block compiler.',
      );
    }

    state.updates.push(
      `${variable}.data = ɵsxString(ɵsxReadLocal(context, ${JSON.stringify(part.value)}));`,
    );
    state.bindingCount += 1;
  }

  return variables;
}

/** A `item.name` / `$index` style read of the collection context. */
const LOCAL_READ = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;


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
