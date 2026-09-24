import {
  emitComponentSetup,
} from './emit-component-setup';
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
 * Input: an Angular component template.
 * Output:
 *  - Angular-safe template with sx bindings removed
 *  - generated direct-binding setup function
 *  - binding count
 *
 * A Vite/esbuild/Angular builder adapter only needs to provide component
 * template discovery and lifecycle insertion around this deterministic core.
 */
export function transformAngularComponentTemplate(
  template: string,
  templateUrl = 'inline-template.html',
): SxBuildTransformResult {
  const transformed = transformSxTemplate(template, templateUrl);

  return {
    template: transformed.template,
    setup: emitComponentSetup(transformed.parsed),
    bindingCount: transformed.parsed.plan.size,
  };
}
