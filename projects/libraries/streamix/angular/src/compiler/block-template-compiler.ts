import {
  TmplAstBoundText,
  TmplAstElement,
  TmplAstText,
  parseTemplate,
  type TmplAstNode,
} from '@angular/compiler';

import type { SxReactiveSourceResolver } from './source-resolution';

export interface SxCompiledBlockBinding {
  readonly node: string;
  readonly source: string;
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
    const emitted = emitNode(node, state);

    if (emitted) {
      state.roots.push(emitted);
    }
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
  parent?: string,
): string | undefined {
  if (node instanceof TmplAstElement) {
    return emitElement(node, state);
  }

  if (node instanceof TmplAstText) {
    return emitStaticText(node.value, state);
  }

  if (node instanceof TmplAstBoundText) {
    return emitBoundText(
      sourceSlice(state.template, node.sourceSpan.start.offset, node.sourceSpan.end.offset),
      state,
      parent,
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
    const childVariable = emitNode(child, state, variable);

    if (childVariable) {
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

function emitBoundText(
  raw: string,
  state: EmitState,
  parent?: string,
): string {
  const variable = nextVariable(state, 'text');
  const parts = parseInterpolation(raw);

  state.create.push(
    `const ${variable} = ${state.document}.createTextNode("");`,
  );

  if (state.resolveReactiveSource) {
    const source = resolveReactiveParts(parts, state);

    if (source) {
      if (!parent) {
        throw new Error(
          'Reactive sx structural blocks require interpolations to live inside an element.',
        );
      }

      // `ɵsxTextNode` binds the element's own interpolation text node.
      state.bindings.push({ node: parent, source });
      state.bindingCount += 1;
      return variable;
    }

    // Loop-local read: refreshed whenever the surrounding block re-renders,
    // because the collection runtime calls the compiled update with the new
    // item/index context.
    if (!state.allowLocals) {
      throw new Error(
        'Reactive sx structural blocks support exactly one source-backed ' +
        'interpolation per text node.',
      );
    }

    const localExpression = parts
      .map(part =>
        part.kind === 'text'
          ? JSON.stringify(part.value)
          : `ɵsxString(ɵsxReadLocal(context, ${JSON.stringify(part.value)}))`,
      )
      .join(' + ');

    state.updates.push(
      `${variable}.data = ${localExpression || '""'};`,
    );
    state.bindingCount += 1;
    return variable;
  }

  const expression = parts
    .map(part =>
      part.kind === 'text'
        ? JSON.stringify(part.value)
        : `ɵsxString(ɵsxReadLocal(context, ${JSON.stringify(part.value)}))`,
    )
    .join(' + ');

  state.updates.push(
    `${variable}.data = ${expression || '""'};`,
  );

  state.bindingCount += 1;
  return variable;
}

/**
 * Reactive mode requires every interpolation part to be a component path that
 * the build adapter proved is an atom; anything else would silently go stale
 * without change detection, so it fails compilation instead.
 */
function resolveReactiveParts(
  parts: readonly InterpolationPart[],
  state: EmitState,
): string | undefined {
  const expressions = parts.filter(
    (part): part is Extract<InterpolationPart, { kind: 'expression' }> =>
      part.kind === 'expression',
  );

  if (expressions.length !== 1) {
    throw new Error(
      'Reactive sx structural blocks support at most one interpolation per text node.',
    );
  }

  return state.resolveReactiveSource!(expressions[0].value);
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

    const expression = match[1].trim();

    if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(expression)) {
      throw new Error(
        `Unsupported sx structural interpolation: ${JSON.stringify(expression)}. ` +
        'Only local/property reads are supported in the direct block compiler.',
      );
    }

    parts.push({
      kind: 'expression',
      value: expression,
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
