import {
  TmplAstElement,
  TmplAstForLoopBlock,
  TmplAstIfBlock,
  TmplAstSwitchBlock,
  parseTemplate,
  type AST,
  type TmplAstNode,
} from '@angular/compiler';

import {
  compileSxBlockTemplate,
  type SxCompiledBlockTemplate,
} from './block-template-compiler';
import type { SxReactiveSourceResolver } from './source-resolution';
import { extractComponentSourcePath } from './text-expression';

export interface SxLoweredBranch {
  /** Resolved reactive source expression, or `null` for `@else`/`@default`. */
  readonly source: string | null;
  /**
   * Literal the source must equal for this branch to render. Present for
   * `@switch` cases; absent for `@if` (truthiness) and `@else`/`@default`.
   */
  readonly match?: string;
  readonly compiled: SxCompiledBlockTemplate;
}

export interface SxLoweredConditionalBlock {
  readonly kind: 'conditional';
  /** Marker id, matching the marker element's `data-sx-block` value. */
  readonly marker: string;
  readonly branches: readonly SxLoweredBranch[];
  /** Root component fields read by this block, for the source-reference bridge. */
  readonly fields: readonly string[];
}

export interface SxLoweredCollectionBlock {
  readonly kind: 'collection';
  readonly marker: string;
  /** Resolved reactive source for the iterated collection. */
  readonly source: string;
  /** Emitted trackBy function text. */
  readonly trackBy: string;
  /** Loop variable name used by the body. */
  readonly item: string;
  readonly compiled: SxCompiledBlockTemplate;
  readonly empty?: SxCompiledBlockTemplate;
  readonly fields: readonly string[];
}

export type SxLoweredBlock =
  | SxLoweredConditionalBlock
  | SxLoweredCollectionBlock;

export interface SxStructuralLowering {
  readonly template: string;
  readonly blocks: readonly SxLoweredBlock[];
  readonly sourceFields: readonly string[];
}

/** Static attribute identifying a lowered structural block marker. */
export const MARKER_ATTRIBUTE = 'data-sx-block';

/**
 * Lowers `@if`/`@else if`/`@else` and `@for`/`@empty` blocks whose sources
 * resolve to reactive atoms and whose bodies compile to direct DOM into marker
 * elements.
 *
 * The lowered block is rendered by the structural runtime with no Angular view
 * and no change detection. Anything that cannot be proven — an unresolvable
 * source, a body containing components/directives/pipes, a nested block, or a
 * block inside another dynamic region — is left untouched for Angular.
 */
export function lowerStructuralBlocks(
  template: string,
  templateUrl: string,
  resolveReactiveSource?: SxReactiveSourceResolver,
): SxStructuralLowering {
  if (!resolveReactiveSource || !/@(?:if|for)\b/.test(template)) {
    return { template, blocks: [], sourceFields: [] };
  }

  let parsed;

  try {
    parsed = parseTemplate(template, templateUrl, {
      preserveWhitespaces: true,
    });
  } catch {
    return { template, blocks: [], sourceFields: [] };
  }

  if (parsed.errors?.length) {
    return { template, blocks: [], sourceFields: [] };
  }

  const blocks = collectStaticBlocks(parsed.nodes);

  if (blocks.length === 0) {
    return { template, blocks: [], sourceFields: [] };
  }

  const lowered: SxLoweredBlock[] = [];
  const edits: { start: number; end: number; replacement: string }[] = [];
  const sourceFields: string[] = [];

  for (const block of blocks) {
    const entry = block instanceof TmplAstIfBlock
      ? tryLowerConditionalBlock(
          block,
          template,
          resolveReactiveSource,
          lowered.length,
        )
      : block instanceof TmplAstSwitchBlock
        ? tryLowerSwitchBlock(
            block,
            template,
            resolveReactiveSource,
            lowered.length,
          )
        : tryLowerCollectionBlock(
            block,
            template,
            resolveReactiveSource,
            lowered.length,
          );

    if (!entry) {
      continue;
    }

    edits.push({
      start: block.sourceSpan.start.offset,
      end: block.sourceSpan.end.offset,
      // A real, schema-known element: Angular's template checker rejects
      // unknown element names (NG8001). The marker is replaced by a comment
      // anchor in the browser and kept (with the content inside it) during
      // server rendering.
      replacement: `<span ${MARKER_ATTRIBUTE}="${entry.marker}"></span>`,
    });
    lowered.push(entry);
    sourceFields.push(...entry.fields);
  }

  if (lowered.length === 0) {
    return { template, blocks: [], sourceFields: [] };
  }

  return {
    template: applyEdits(template, edits),
    blocks: lowered,
    sourceFields: [...new Set(sourceFields)],
  };
}

function applyEdits(
  template: string,
  edits: readonly { start: number; end: number; replacement: string }[],
): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let transformed = template;

  for (const edit of ordered) {
    transformed =
      transformed.slice(0, edit.start) +
      edit.replacement +
      transformed.slice(edit.end);
  }

  return transformed;
}

/**
 * Collects `@if`/`@for` blocks whose ancestry is static elements only. Blocks
 * nested in another block or in a dynamic region are skipped: their DOM
 * position is not a fixed host path, so the compiled block cannot address it.
 */
function collectStaticBlocks(
  nodes: readonly TmplAstNode[],
): (TmplAstIfBlock | TmplAstForLoopBlock | TmplAstSwitchBlock)[] {
  const blocks: (TmplAstIfBlock | TmplAstForLoopBlock | TmplAstSwitchBlock)[] = [];

  for (const node of nodes) {
    if (
      node instanceof TmplAstIfBlock ||
      node instanceof TmplAstForLoopBlock ||
      node instanceof TmplAstSwitchBlock
    ) {
      blocks.push(node);
      continue;
    }

    if (node instanceof TmplAstElement) {
      blocks.push(...collectStaticBlocks(node.children));
    }
  }

  return blocks;
}

function tryLowerConditionalBlock(
  block: TmplAstIfBlock,
  template: string,
  resolveReactiveSource: SxReactiveSourceResolver,
  index: number,
): SxLoweredConditionalBlock | undefined {
  if (block.branches.length === 0) {
    return undefined;
  }

  const branches: SxLoweredBranch[] = [];
  const fields: string[] = [];

  for (const branch of block.branches) {
    let source: string | null = null;

    if (branch.expression) {
      const condition = expressionSource(branch.expression, template);
      const path = condition
        ? extractComponentSourcePath(condition)
        : undefined;
      source = path ? resolveReactiveSource(path) ?? null : null;

      if (!source) {
        return undefined;
      }

      const field = rootComponentField(source);

      if (field) {
        fields.push(field);
      }
    }

    const body = bodySourceOf(branch.children, template);

    if (!body) {
      return undefined;
    }

    let compiled: SxCompiledBlockTemplate;

    try {
      compiled = compileSxBlockTemplate(body, 'sx-block.html', {
        documentExpression: 'doc',
        resolveReactiveSource,
      });
    } catch {
      return undefined;
    }

    if (compiled.rootNodes.length === 0) {
      return undefined;
    }

    branches.push({ source, compiled });
  }

  return {
    kind: 'conditional',
    marker: String(index),
    branches,
    fields: [...new Set(fields)],
  };
}

/**
 * `@switch`/`@case`/`@default`. Every case of every group becomes a branch of
 * the same conditional block, comparing the switch source by identity. Case
 * values must be literals: the generated factory compares them directly, so an
 * arbitrary expression could not be evaluated without Angular.
 */
function tryLowerSwitchBlock(
  block: TmplAstSwitchBlock,
  template: string,
  resolveReactiveSource: SxReactiveSourceResolver,
  index: number,
): SxLoweredConditionalBlock | undefined {
  const expression = expressionSource(block.expression, template);
  const path = expression ? extractComponentSourcePath(expression) : undefined;
  const source = path ? resolveReactiveSource(path) ?? null : null;

  if (!source || block.groups.length === 0) {
    return undefined;
  }

  const cases: SxLoweredBranch[] = [];
  const defaults: SxLoweredBranch[] = [];
  const fields: string[] = [];

  for (const group of block.groups) {
    const body = bodySourceOf(group.children, template);

    if (!body) {
      return undefined;
    }

    let compiled: SxCompiledBlockTemplate;

    try {
      compiled = compileSxBlockTemplate(body, 'sx-block.html', {
        documentExpression: 'doc',
        resolveReactiveSource,
      });
    } catch {
      return undefined;
    }

    if (compiled.rootNodes.length === 0) {
      return undefined;
    }

    for (const caseNode of group.cases) {
      const caseExpression = caseNode.expression;

      if (!caseExpression) {
        defaults.push({ source: null, compiled });
        continue;
      }

      const match = expressionSource(caseExpression, template);

      if (!match || !isLiteralExpression(match)) {
        return undefined;
      }

      cases.push({ source, match, compiled });
    }
  }

  const field = rootComponentField(source);

  if (field) {
    fields.push(field);
  }

  return {
    kind: 'conditional',
    marker: String(index),
    // Defaults render only when no case matched, so they go last.
    branches: [...cases, ...defaults],
    fields: [...new Set(fields)],
  };
}

/** Accepts only the literals a generated comparison can evaluate directly. */
function isLiteralExpression(text: string): boolean {
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

function tryLowerCollectionBlock(
  block: TmplAstForLoopBlock,
  template: string,
  resolveReactiveSource: SxReactiveSourceResolver,
  index: number,
): SxLoweredCollectionBlock | undefined {
  const expression = expressionSource(block.expression, template);
  const item = block.item.name;
  const path = expression ? extractComponentSourcePath(expression) : undefined;
  const source = path ? resolveReactiveSource(path) ?? null : null;

  if (!source) {
    return undefined;
  }

  const trackBy = block.trackBy
    ? trackByFunction(block.trackBy, template, item)
    : undefined;

  if (!trackBy) {
    return undefined;
  }

  const body = bodySourceOf(block.children, template);

  if (!body) {
    return undefined;
  }

  let compiled: SxCompiledBlockTemplate;

  try {
    compiled = compileSxBlockTemplate(body, 'sx-block.html', {
      documentExpression: 'doc',
      resolveReactiveSource,
      allowLocals: true,
    });
  } catch {
    return undefined;
  }

  if (compiled.rootNodes.length === 0) {
    return undefined;
  }

  let empty: SxCompiledBlockTemplate | undefined;

  if (block.empty) {
    const emptyBody = bodySourceOf(block.empty.children, template);

    if (!emptyBody) {
      return undefined;
    }

    try {
      empty = compileSxBlockTemplate(emptyBody, 'sx-block-empty.html', {
        documentExpression: 'doc',
        resolveReactiveSource,
      });
    } catch {
      return undefined;
    }

    if (empty.rootNodes.length === 0) {
      return undefined;
    }
  }

  return {
    kind: 'collection',
    marker: String(index),
    source,
    trackBy,
    item,
    compiled,
    empty,
    fields: [...new Set([rootComponentField(source)].filter(isField))],
  };
}

/**
 * Emits a trackBy function for the supported `track` shapes. Anticipating
 * Angular's default, `$index` is positional and a plain item path is keyed by
 * that path; anything else stays Angular-owned.
 */
function trackByFunction(
  trackBy: AST,
  template: string,
  item: string,
): string | undefined {
  const text = expressionSource(trackBy, template);

  if (!text) {
    return undefined;
  }

  if (text === '$index') {
    return '(_index) => _index';
  }

  const itemPath = new RegExp(
    `^${item}(?:\\.[A-Za-z_$][\\w$]*)*$`,
  );

  return itemPath.test(text)
    ? `(_index, ${item}) => ${text}`
    : undefined;
}

function isField(value: string | undefined): value is string {
  return !!value;
}

function expressionSource(
  expression: AST,
  template: string,
): string | undefined {
  const source = (expression as { source?: unknown }).source;

  if (typeof source === 'string' && source.trim()) {
    return source.trim();
  }

  const span = expression.sourceSpan;

  return span
    ? template.slice(spanStart(span), spanEnd(span)).trim()
    : undefined;
}

function bodySourceOf(
  children: readonly TmplAstNode[],
  template: string,
): string | undefined {
  if (!children || children.length === 0) {
    return undefined;
  }

  const start = spanStart(children[0].sourceSpan);
  const end = spanEnd(children[children.length - 1].sourceSpan);

  return template.slice(start, end);
}

/**
 * Angular types `sourceSpan` boundaries as `ParseLocation` for template nodes
 * and as plain offsets for AST nodes; accept both.
 */
function spanStart(span: { readonly start: unknown }): number {
  return typeof span.start === 'number'
    ? span.start
    : (span.start as { offset: number }).offset;
}

function spanEnd(span: { readonly end: unknown }): number {
  return typeof span.end === 'number'
    ? span.end
    : (span.end as { offset: number }).offset;
}

function rootComponentField(source: string): string | undefined {
  return /^([A-Za-z_$][\w$]*)/.exec(source.trim())?.[1];
}
