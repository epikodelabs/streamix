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
   * Streamix bindings or by compiler-linked structural `*sx` directives.
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
 * Lowers a direct source-valued Angular `@if` condition to its reactive
 * source's `.value` fallback. Angular remains responsible for block DOM;
 * generated subscriptions only refresh that local view when the source emits.
 */
function instrumentAngularControlFlow(
  template: string,
  options: ParseSxTemplateOptions,
): {
  template: string;
  sources: readonly string[];
  fields: readonly string[];
} {
  const pattern = /@if\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g;
  const replacements = new Map<string, string>();
  const sources: string[] = [];
  const fields: string[] = [];

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
