import {
  emitComponentSetup,
} from './emit-component-setup';
import type { ParseSxTemplateOptions } from './angular-template-parser';
import type { SxBindingPlan } from './binding-plan';
import {
  transformSxTemplate,
} from './template-transform';

export interface SxBuildTransformResult {
  readonly template: string;
  readonly setup: string;
  readonly bindingCount: number;
  /**
   * Top-level component fields whose object identity is consumed by generated
   * Streamix bindings or compiler-linked Angular control-flow blocks.
   */
  readonly sourceReferenceFields: readonly string[];
  /** True only when at least one generated slot delegates rendering to Angular. */
  readonly requiresAngularInvalidation: boolean;
}

/**
 * Build-tool-facing sx transform.
 *
 * `options.resolveReactiveSource` should be backed by the component TypeScript
 * checker when source-transparent templates are enabled. It may map a value-first
 * Scope path such as `model.count` to the atom at `model.count`.
 */
export function transformAngularComponentTemplate(
  template: string,
  templateUrl = 'inline-template.html',
  options: ParseSxTemplateOptions = {},
): SxBuildTransformResult {
  if (/\*sx\s*=/.test(template)) {
    throw new Error(
      'Unsupported legacy Streamix structural directive "*sx". ' +
      'Use standard Angular control flow such as @if (model.ready) instead.',
    );
  }

  const controlFlow = instrumentAngularControlFlow(template, options);
  const transformed = transformSxTemplate(
    controlFlow.template,
    templateUrl,
    {
      ...options,
      angularInvalidationSources: controlFlow.sources,
    },
  );

  return {
    template: transformed.template,
    setup: emitComponentSetup(transformed.parsed),
    bindingCount: transformed.parsed.plan.size,
    sourceReferenceFields: mergeFields(
      collectSourceReferenceFields(transformed.parsed.plan),
      controlFlow.fields,
    ),
    requiresAngularInvalidation:
      transformed.parsed.plan.bindings.some(
        binding => binding.kind === 'angular-invalidate',
      ),
  };
}

/**
 * Lowers direct source-valued Angular control-flow expressions (`@if`,
 * `@else if`, `@switch`, `@for`, `*ngIf`, `*ngFor`, and `ngSwitch`) and their
 * block content to reactive-source `.value` fallbacks. Angular remains
 * responsible for block DOM; generated subscriptions only refresh that local
 * view when a referenced source emits.
 */
function instrumentAngularControlFlow(
  template: string,
  options: ParseSxTemplateOptions,
): {
  template: string;
  sources: readonly string[];
  fields: readonly string[];
} {
  const patterns = [
    /@(?:else\s+)?if\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g,
    /@switch\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g,
    /@for\s*\(\s*[A-Za-z_$][\w$]*\s+of\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?=[;)])/g,
    /\*ngIf\s*=\s*["']\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?=;|as\s|["'])/g,
    /\*ngFor\s*=\s*["'][\s\S]*?\bof\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?=;|["'])/g,
    /\[ngSwitch\]\s*=\s*["']\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*["']/g,
  ];
  const hasStructuralRegion = /@(?:if|for|switch)\s*\(|\*ng(?:If|For|SwitchCase)\s*=|\[ngSwitch\]\s*=/.test(
    template,
  );
  const replacements = new Map<string, string>();
  const handledPaths = new Set<string>();
  const sources: string[] = [];
  const fields: string[] = [];

  const recordSource = (valuePath: string): void => {
    if (handledPaths.has(valuePath)) {
      return;
    }

    const source = options.resolveReactiveSource?.(valuePath);
    if (!source) {
      return;
    }

    handledPaths.add(valuePath);
    if (!source.includes('.get(')) {
      replacements.set(valuePath, `${source}.value`);
    }
    sources.push(source);
    const field = rootComponentField(source);
    if (field && !fields.includes(field)) {
      fields.push(field);
    }
  };

  for (const pattern of patterns) {
    for (const match of template.matchAll(pattern)) {
      recordSource(match[1]);
    }
  }

  // Angular owns nodes below a structural boundary, so the static-node parser
  // deliberately does not visit them. Find any additional direct atom paths
  // in Angular expression contexts and make their fallback value-readable too.
  // The matching source subscriptions are what keep an already-created block
  // fresh when its condition/iterable has not changed.
  const spans = hasStructuralRegion ? angularExpressionSpans(template) : [];

  for (const span of spans) {
    for (const valuePath of componentPathsInExpression(span.text)) {
      recordSource(valuePath);
    }
  }

  if (replacements.size === 0) {
    return { template, sources, fields };
  }

  return {
    template: rewriteExpressionSpans(template, spans, replacements),
    sources,
    fields,
  };
}

interface SxExpressionSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Returns Angular-evaluated expression contexts only: interpolation contents,
 * quoted property/directive/event binding values, and control-flow conditions
 * (including `@else if`). Static attribute values and prose are never
 * returned, so recorded paths cannot leak into non-expression text.
 */
function angularExpressionSpans(template: string): SxExpressionSpan[] {
  const spans: SxExpressionSpan[] = [];

  const push = (start: number, end: number): void => {
    if (end > start) {
      spans.push({ start, end, text: template.slice(start, end) });
    }
  };

  // Quoted value of an attribute-shaped binding: the value ends exactly one
  // character (the closing quote) before the end of the match.
  const pushQuoted = (match: RegExpMatchArray, group: number): void => {
    const value = match[group] ?? '';
    const start = match.index! + match[0].length - value.length - 1;
    push(start, start + value.length);
  };

  for (const match of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    push(match.index! + 2, match.index! + match[0].length - 2);
  }

  for (const match of template.matchAll(/\[[^\]]+\]\s*=\s*(["'])([\s\S]*?)\1/g)) {
    pushQuoted(match, 2);
  }

  for (const match of template.matchAll(/\*ng[A-Za-z_$][\w$]*\s*=\s*(["'])([\s\S]*?)\1/g)) {
    pushQuoted(match, 2);
  }

  for (const match of template.matchAll(/\(([^)]+)\)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    pushQuoted(match, 3);
  }

  for (const match of template.matchAll(/@(?:else\s+)?(?:if|switch|for)\s*\(([\s\S]*?)\)/g)) {
    const openParen = match.index! + match[0].indexOf('(') + 1;
    push(openParen, match.index! + match[0].length - 1);
  }

  return spans;
}

/**
 * Applies recorded path replacements inside expression spans only, in one
 * longest-first pass. Longest-first keeps a longer recorded path
 * (`state.items`) from being clobbered by a recorded prefix (`state`), and
 * the span restriction keeps static attributes, prose, and string literals
 * inside expressions untouched.
 */
function rewriteExpressionSpans(
  template: string,
  spans: readonly SxExpressionSpan[],
  replacements: ReadonlyMap<string, string>,
): string {
  const paths = [...replacements.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![\\w$.])(?:${paths.map(escapeRegExp).join('|')})(?![\\w$])`,
    'g',
  );
  const rewrite = (text: string): string =>
    text.replace(pattern, (match, offset: number) =>
      isInsideString(text, offset) ? match : replacements.get(match)!,
    );

  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let result = '';
  let cursor = 0;

  for (const span of ordered) {
    if (span.start < cursor) {
      // Nested span; the enclosing rewrite already covered its text.
      continue;
    }

    result += template.slice(cursor, span.start) + rewrite(span.text);
    cursor = span.end;
  }

  return result + template.slice(cursor);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function componentPathsInExpression(expression: string): readonly string[] {
  const paths: string[] = [];
  const pattern = /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\b/g;

  for (const match of expression.matchAll(pattern)) {
    if (match.index == null || isInsideString(expression, match.index)) {
      continue;
    }
    paths.push(match[0]);
  }

  return paths;
}

function isInsideString(expression: string, offset: number): boolean {
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < offset; index += 1) {
    const char = expression[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    }
  }
  return quote !== undefined;
}

function collectSourceReferenceFields(
  plan: SxBindingPlan,
): readonly string[] {
  const fields: string[] = [];
  const seen = new Set<string>();

  for (const binding of plan.bindings) {
    const sourcePaths = binding.dependencies ?? [binding.source];

    for (const sourcePath of sourcePaths) {
      const field = rootComponentField(sourcePath);

      if (!field || seen.has(field)) {
        continue;
      }

      seen.add(field);
      fields.push(field);
    }
  }

  return fields;
}

function rootComponentField(path: string): string | undefined {
  const match = /^([A-Za-z_$][\w$]*)/.exec(path.trim());
  return match?.[1];
}

function mergeFields(
  first: readonly string[],
  second: readonly string[],
): readonly string[] {
  const fields: string[] = [];
  const seen = new Set<string>();

  for (const field of [...first, ...second]) {
    if (seen.has(field)) {
      continue;
    }

    seen.add(field);
    fields.push(field);
  }

  return fields;
}
