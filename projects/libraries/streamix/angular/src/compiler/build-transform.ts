import {
  emitComponentSetup,
} from './emit-component-setup';
import type { ParseSxTemplateOptions } from './angular-template-parser';
import {
  transformSxTemplate,
} from './template-transform';

export interface SxBuildTransformResult {
  readonly template: string;
  readonly setup: string;
  readonly bindingCount: number;
}

/**
 * Build-tool-facing sx transform.
 *
 * `options.isDependencySource` should be backed by the component TypeScript
 * checker when source-transparent templates are enabled.
 */
export function transformAngularComponentTemplate(
  template: string,
  templateUrl = 'inline-template.html',
  options: ParseSxTemplateOptions = {},
): SxBuildTransformResult {
  const transformed = transformSxTemplate(template, templateUrl, options);

  return {
    template: transformed.template,
    setup: emitComponentSetup(transformed.parsed),
    bindingCount: transformed.parsed.plan.size,
  };
}
