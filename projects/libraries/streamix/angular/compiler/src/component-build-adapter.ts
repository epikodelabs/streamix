import {
  emitLifecycleInitializer,
} from './emit-component-module';
import {
  transformAngularComponentTemplate,
} from './build-transform';
import {
  adaptDependencySourceResolver,
  combineReactiveSourceResolvers,
  combineReactiveWritableResolvers,
  createDependencySourcePathResolver,
  createReactiveSourcePathResolver,
  createScopeValuePathResolver,
  createScopeWritableResolver,
  createWritableSourcePathResolver,
  type SxDependencySourceResolver,
  type SxReactiveSourceResolver,
  type SxReactiveWritableResolver,
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
   * `{ model: ['count', 'user.name'] }` maps to public atom lookups such as
   * `model.get('count')` and `model.get('user.name')`.
   */
  readonly scopeValuePaths?: Readonly<Record<string, readonly string[]>>;
  /**
   * TypeScript-checker-backed writable resolver for two-way bindings. Only
   * paths backed by a writable atom may resolve.
   */
  readonly resolveReactiveWritable?: SxReactiveWritableResolver;
  /** Standalone writable atom property paths. */
  readonly writableSourcePaths?: readonly string[];
  /**
   * Scope members that hold writable atoms, grouped by Scope path. Derived
   * members must not appear: writing one throws at runtime.
   */
  readonly scopeWritablePaths?: Readonly<Record<string, readonly string[]>>;
}

export interface SxComponentBuildOutput {
  readonly transformedTemplate: string;
  /**
   * Module-level setup function for the compiled bindings. It is inlined into
   * the component module so the component never imports a generated file.
   */
  readonly setupCode?: string;
  readonly lifecycleInitializer?: string;
  readonly bindingCount: number;
  readonly sourceReferenceFields: readonly string[];
}

/**
 * Deterministic build-adapter core for one Angular component.
 *
 * It does not depend on a particular Angular CLI/bundler implementation.
 * An application builder only needs to:
 *
 * 1. supply component/template discovery;
 * 2. write `transformedTemplate` back into the virtual compilation input;
 * 3. inline `setupCode` into the component module;
 * 4. insert `lifecycleInitializer` into the component class and imports for
 *    `ɵinstallSxCompiledView` plus the setup runtime primitives.
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

  const resolveReactiveWritable = combineReactiveWritableResolvers(
    input.resolveReactiveWritable,
    input.writableSourcePaths
      ? createWritableSourcePathResolver(input.writableSourcePaths)
      : undefined,
    input.scopeWritablePaths
      ? createScopeWritableResolver(input.scopeWritablePaths)
      : undefined,
  );

  const transformed = transformAngularComponentTemplate(
    input.template,
    input.templatePath ?? input.componentPath,
    { resolveReactiveSource, resolveReactiveWritable },
  );

  // A component whose only compiled content is a control-flow block has no
  // binding-table slots but still needs the compiled view installed.
  if (
    transformed.bindingCount === 0 &&
    transformed.structuralBlockCount === 0
  ) {
    return {
      // A source-transparent sanitizer-sensitive binding may require only an
      // Angular `.value` fallback edit and no direct browser binding.
      transformedTemplate: transformed.template,
      bindingCount: 0,
      sourceReferenceFields: transformed.sourceReferenceFields,
    };
  }

  return {
    transformedTemplate: transformed.template,
    setupCode: transformed.setup,
    lifecycleInitializer: emitLifecycleInitializer(
      'ɵsetupSxBindings',
      {
        sourceReferences: transformed.sourceReferenceFields,
        },
    ),
    bindingCount: transformed.bindingCount,
    sourceReferenceFields: transformed.sourceReferenceFields,
  };
}
