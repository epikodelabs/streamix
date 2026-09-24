import {
  emitLifecycleInitializer,
  emitRuntimeImportHeader,
} from './emit-component-module';
import {
  transformAngularComponentTemplate,
} from './build-transform';

export interface SxComponentBuildInput {
  readonly componentPath: string;
  readonly template: string;
  readonly templatePath?: string;
}

export interface SxGeneratedFile {
  readonly path: string;
  readonly contents: string;
}

export interface SxComponentBuildOutput {
  readonly transformedTemplate: string;
  readonly generatedModule?: SxGeneratedFile;
  readonly lifecycleInitializer?: string;
  readonly bindingCount: number;
}

/**
 * Deterministic build-adapter core for one Angular component.
 *
 * It does not depend on a particular Angular CLI/bundler implementation.
 * An application builder only needs to:
 *
 * 1. supply component/template discovery;
 * 2. write `transformedTemplate` back into the virtual compilation input;
 * 3. add `generatedModule`;
 * 4. insert `lifecycleInitializer` into the component class and imports for
 *    `ɵinstallSxCompiledView` plus the generated setup function.
 */
export function compileSxComponent(
  input: SxComponentBuildInput,
): SxComponentBuildOutput {
  const transformed = transformAngularComponentTemplate(
    input.template,
    input.templatePath ?? input.componentPath,
  );

  if (transformed.bindingCount === 0) {
    return {
      transformedTemplate: input.template,
      bindingCount: 0,
    };
  }

  const generatedPath = `${input.componentPath}.sx.ts`;

  return {
    transformedTemplate: transformed.template,
    generatedModule: {
      path: generatedPath,
      contents: emitComponentModuleFromSetup(
        transformed.setup,
      ),
    },
    lifecycleInitializer: emitLifecycleInitializer(),
    bindingCount: transformed.bindingCount,
  };
}

/**
 * Keeps the builder result based on the exact setup code already emitted by
 * the template transform. This avoids parsing the template twice.
 */
function emitComponentModuleFromSetup(
  setup: string,
): string {
  return [
    emitRuntimeImportHeader(),
    ``,
    setup,
    ``,
  ].join('\n');
}
