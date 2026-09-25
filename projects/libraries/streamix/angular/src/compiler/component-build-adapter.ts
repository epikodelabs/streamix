import {
  emitLifecycleInitializer,
  emitRuntimeImportHeader,
  emitSourceReferenceInitializer,
} from './emit-component-module';
import {
  transformAngularComponentTemplate,
} from './build-transform';
import {
  adaptDependencySourceResolver,
  combineReactiveSourceResolvers,
  createDependencySourcePathResolver,
  createReactiveSourcePathResolver,
  createScopeValuePathResolver,
  type SxDependencySourceResolver,
  type SxReactiveSourceResolver,
} from './source-resolution';

export interface SxComponentBuildInput {
  readonly componentPath: string;
  readonly template: string;
  readonly templatePath?: string;
  /**
   * TypeScript-checker-backed resolver for source-transparent template syntax.
   * Prefer this in real builder integrations.
   */
  readonly resolveReactiveSource?: SxReactiveSourceResolver;
  /** @deprecated Prefer `resolveReactiveSource`. */
  readonly isDependencySource?: SxDependencySourceResolver;
  /** Standalone DependencySource property paths. */
  readonly dependencySourcePaths?: readonly string[];
  /** Explicit value-path -> reactive-source-path metadata. */
  readonly reactiveSourcePaths?: Readonly<Record<string, string>>;
  /**
   * Scope value members grouped by Scope path. For example
   * `{ model: ['count', 'user.name'] }` maps to
   * `model.refs.count` and `model.refs.user.name`.
   */
  readonly scopeValuePaths?: Readonly<Record<string, readonly string[]>>;
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
  readonly sourceReferenceFields: readonly string[];
  readonly requiresAngularInvalidation: boolean;
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
  const resolveReactiveSource = combineReactiveSourceResolvers(
    input.resolveReactiveSource,
    input.reactiveSourcePaths
      ? createReactiveSourcePathResolver(input.reactiveSourcePaths)
      : undefined,
    input.scopeValuePaths
      ? createScopeValuePathResolver(input.scopeValuePaths)
      : undefined,
    input.dependencySourcePaths
      ? createDependencySourcePathResolver(input.dependencySourcePaths)
      : undefined,
    adaptDependencySourceResolver(input.isDependencySource),
  );

  const transformed = transformAngularComponentTemplate(
    input.template,
    input.templatePath ?? input.componentPath,
    { resolveReactiveSource },
  );

  if (transformed.bindingCount === 0) {
    return {
      // A source-transparent sanitizer-sensitive binding may require only an
      // Angular `.value` fallback edit and no direct browser binding. A
      // structural `*sx` template may still need the source-reference registry
      // even though it does not emit a static binding table.
      transformedTemplate: transformed.template,
      lifecycleInitializer: transformed.sourceReferenceFields.length > 0
        ? emitSourceReferenceInitializer(transformed.sourceReferenceFields)
        : undefined,
      bindingCount: 0,
      sourceReferenceFields: transformed.sourceReferenceFields,
      requiresAngularInvalidation: false,
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
    lifecycleInitializer: emitLifecycleInitializer(
      'ɵsetupSxBindings',
      {
        sourceReferences: transformed.sourceReferenceFields,
        angularInvalidation: transformed.requiresAngularInvalidation,
      },
    ),
    bindingCount: transformed.bindingCount,
    sourceReferenceFields: transformed.sourceReferenceFields,
    requiresAngularInvalidation: transformed.requiresAngularInvalidation,
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
