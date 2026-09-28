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
 * Scope path such as `model.count` to `model.refs.count`.
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
 * Lowers direct source-valued Angular control-flow expressions (`@if`, `@for`,
 * `@switch`, `*ngIf`, `*ngFor`, and `ngSwitch`) and their block content to
 * reactive-source `.value` fallbacks. Angular remains responsible for block
 * DOM; generated subscriptions only refresh that local view when a referenced
 * source emits.
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
    /@if\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g,
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
  const sources: string[] = [];
  const fields: string[] = [];

  for (const pattern of patterns) {
    for (const match of template.matchAll(pattern)) {
      const valuePath = match[1];
      const source = options.resolveReactiveSource?.(valuePath);
      if (!source || replacements.has(valuePath)) {
        continue;
      }

      replacements.set(valuePath, `${source}.value`);
      sources.push(source);
      const field = rootComponentField(source);
      if (field && !fields.includes(field)) {
        fields.push(field);
      }
    }
  }

  // Angular owns nodes below a structural boundary, so the static-node parser
  // deliberately does not visit them. Find any additional direct atom paths
  // in that template and make their Angular fallback value-readable too. The
  // matching source subscriptions are what keep an already-created block fresh
  // when its condition/iterable has not changed.
  if (hasStructuralRegion) {
    for (const expression of angularExpressionFragments(template)) {
      for (const valuePath of componentPathsInExpression(expression)) {
      const source = options.resolveReactiveSource?.(valuePath);
      if (!source || replacements.has(valuePath)) {
        continue;
      }

      replacements.set(valuePath, `${source}.value`);
      sources.push(source);
      const field = rootComponentField(source);
      if (field && !fields.includes(field)) {
        fields.push(field);
      }
      }
    }
  }

  let transformed = template;
  for (const [valuePath, fallback] of replacements) {
    const escaped = valuePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    transformed = transformed.replace(
      new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`, 'g'),
      fallback,
    );
  }

  return { template: transformed, sources, fields };
}

/** Returns only Angular expression text, never ordinary static attributes. */
function angularExpressionFragments(template: string): readonly string[] {
  const expressions: string[] = [];
  const patterns = [
    /\{\{([\s\S]*?)\}\}/g,
    /\[[^\]]+\]\s*=\s*(["'])([\s\S]*?)\1/g,
    /\*ng[A-Za-z_$][\w$]*\s*=\s*(["'])([\s\S]*?)\1/g,
    /@(?:if|switch|for)\s*\(([\s\S]*?)\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of template.matchAll(pattern)) {
      expressions.push(match[2] ?? match[1] ?? '');
    }
  }

  return expressions;
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
