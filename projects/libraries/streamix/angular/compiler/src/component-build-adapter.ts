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
  readonly componentSelectors?: readonly string[];
  readonly componentPath: string;
  readonly template: string;
  readonly templatePath?: string;
  /**
   * Mirrors the component's `preserveWhitespaces` decorator option so
   * interpolation text addressing counts the same text nodes Angular renders.
   */
  readonly preserveWhitespaces?: boolean;
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
   * Scope value members grouped by Scope path. Dotted members address nested
   * scopes: `{ model: ['count', 'user.name'] }` maps to public atom lookups
   * such as `model.get('count')` and `model.get('user').get('name')`.
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
  /**
   * Component class fields initialized by `scope(...)`. The generated view
   * disposes them with the component, including components whose template
   * compiles no bindings.
   */
  readonly ownedScopeFields?: readonly string[];
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
    {
      resolveReactiveSource,
      resolveReactiveWritable,
      componentSelectors: input.componentSelectors,
      preserveWhitespaces: input.preserveWhitespaces,
    },
  );

  const ownedScopes = input.ownedScopeFields ?? [];

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
      // A scope-only component still installs the view handle so its owned
      // scopes are disposed with the component.
      ...(ownedScopes.length > 0
        ? {
          lifecycleInitializer: emitLifecycleInitializer(undefined, {
            ownedScopes,
          }),
        }
        : {}),
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
        ownedScopes,
        },
    ),
    bindingCount: transformed.bindingCount,
    sourceReferenceFields: transformed.sourceReferenceFields,
  };
}
