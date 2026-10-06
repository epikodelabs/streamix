import {
  emitComponentSetup,
} from './emit-component-setup';
import type { ParseSxTemplateOptions } from './angular-template-parser';
import type { SxBindingPlan } from './binding-plan';
import {
  angularOwnedReadError,
  lowerStructuralBlocks,
} from './structural-lowering';
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
  /**
   * Number of compiler-owned control-flow blocks. A component can consist
   * entirely of structural blocks, in which case there are no binding-table
   * slots but the compiled view still has to be installed.
   */
  readonly structuralBlockCount: number;
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

  const lowering = lowerStructuralBlocks(
    template,
    templateUrl,
    options.resolveReactiveSource,
  );
  if (lowering.rejected.length > 0) {
    throw new Error(angularOwnedReadError(lowering.rejected[0]));
  }

  const transformed = transformSxTemplate(
    lowering.template,
    templateUrl,
    options,
  );

  return {
    template: transformed.template,
    setup: emitComponentSetup(
      transformed.parsed,
      undefined,
      lowering.blocks,
    ),
    bindingCount: transformed.parsed.plan.size,
    sourceReferenceFields: mergeFields(
      collectSourceReferenceFields(transformed.parsed.plan),
      lowering.sourceFields,
    ),
    structuralBlockCount: lowering.blocks.length,
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
