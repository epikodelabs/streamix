import {
  emitComponentSetup,
} from './emit-component-setup';
import type { ParseSxTemplateOptions } from './angular-template-parser';
import type { SxBindingPlan } from './binding-plan';
import {
  transformSxTemplate,
} from './template-transform';
import { SX_SOURCE_REFERENCES_FIELD } from './generated-names';

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
  const structural = instrumentStructuralSourceReferences(template);
  const transformed = transformSxTemplate(
    structural.template,
    templateUrl,
    options,
  );

  return {
    template: transformed.template,
    setup: emitComponentSetup(transformed.parsed),
    bindingCount: transformed.parsed.plan.size,
    sourceReferenceFields: mergeFields(
      collectSourceReferenceFields(transformed.parsed.plan),
      structural.fields,
    ),
    requiresAngularInvalidation:
      transformed.parsed.plan.bindings.some(
        binding => binding.kind === 'angular-invalidate',
      ),
  };
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

/**
 * Adds a compiler-only microsyntax input to simple structural source fields:
 *
 *   *sx="source as value"
 *
 * becomes
 *
 *   *sx="source as value; sourceRef: __sxRefs.source"
 *
 * Angular desugars `sourceRef` to the directive input `sxSourceRef`. Authored
 * templates never need to mention this bridge.
 */
function instrumentStructuralSourceReferences(
  template: string,
): { template: string; fields: readonly string[] } {
  const fields: string[] = [];
  const seen = new Set<string>();
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const pattern = /\*sx\s*=\s*(["'])([\s\S]*?)\1/g;

  for (const match of template.matchAll(pattern)) {
    if (match.index == null) {
      continue;
    }

    const full = match[0];
    const microsyntax = match[2];

    if (/(?:^|;)\s*sourceRef\s*:/.test(microsyntax)) {
      continue;
    }

    const field = structuralSourceField(microsyntax);
    if (!field) {
      continue;
    }

    if (!seen.has(field)) {
      seen.add(field);
      fields.push(field);
    }

    const normalized = microsyntax.trim().replace(/;\s*$/, '');
    const next = `${normalized}; sourceRef: ${SX_SOURCE_REFERENCES_FIELD}.${field}`;
    const valueStart = match.index + full.indexOf(microsyntax);

    edits.push({
      start: valueStart,
      end: valueStart + microsyntax.length,
      replacement: next,
    });
  }

  let transformed = template;
  for (const edit of edits.reverse()) {
    transformed =
      transformed.slice(0, edit.start) +
      edit.replacement +
      transformed.slice(edit.end);
  }

  return { template: transformed, fields };
}

function structuralSourceField(microsyntax: string): string | undefined {
  const collection = /^\s*let\s+[A-Za-z_$][\w$]*\s+of\s+([^;]+)/.exec(
    microsyntax,
  );

  const source = collection
    ? collection[1].trim()
    : microsyntax
        .split(';', 1)[0]
        .replace(/\s+as\s+[A-Za-z_$][\w$]*\s*$/, '')
        .trim();

  return /^[A-Za-z_$][\w$]*$/.test(source)
    ? source
    : undefined;
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
