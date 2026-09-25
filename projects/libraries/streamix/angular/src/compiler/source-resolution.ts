/**
 * Legacy boolean classifier for standalone DependencySource paths.
 * Prefer {@link SxReactiveSourceResolver} for new integrations.
 */
export type SxDependencySourceResolver = (path: string) => boolean;

/**
 * Compile-time mapping from a value-facing template path to the reactive
 * DependencySource path that backs it.
 *
 * Examples:
 * - `count` -> `count` for a standalone atom/readable.
 * - `model.count` -> `model.refs.count` for a value-first Scope member.
 */
export type SxReactiveSourceResolver = (path: string) => string | undefined;

/**
 * Adapts the legacy boolean source classifier to the richer path resolver.
 */
export function adaptDependencySourceResolver(
  resolver: SxDependencySourceResolver | undefined,
): SxReactiveSourceResolver | undefined {
  return resolver ? path => resolver(path) ? path : undefined : undefined;
}

/**
 * Creates a deterministic resolver for standalone DependencySource paths.
 */
export function createDependencySourcePathResolver(
  paths: Iterable<string>,
): SxReactiveSourceResolver {
  const sources = new Set(paths);
  return path => sources.has(path) ? path : undefined;
}

/**
 * Creates a resolver from explicit value-path -> reactive-source-path metadata.
 */
export function createReactiveSourcePathResolver(
  paths: Readonly<Record<string, string>>,
): SxReactiveSourceResolver {
  return path => paths[path];
}

/**
 * Creates scope-member mappings from exact value paths discovered by an
 * upstream type checker. Nested members follow the recursive `refs` mirror:
 * `model.user.name` -> `model.refs.user.name`.
 */
export function createScopeValuePathResolver(
  scopes: Readonly<Record<string, readonly string[]>>,
): SxReactiveSourceResolver {
  const mappings: Record<string, string> = {};

  for (const [scopePath, members] of Object.entries(scopes)) {
    for (const member of members) {
      mappings[`${scopePath}.${member}`] = `${scopePath}.refs.${member}`;
    }
  }

  return createReactiveSourcePathResolver(mappings);
}

/** Combines resolvers in priority order. */
export function combineReactiveSourceResolvers(
  ...resolvers: Array<SxReactiveSourceResolver | undefined>
): SxReactiveSourceResolver | undefined {
  const active = resolvers.filter(
    (resolver): resolver is SxReactiveSourceResolver => !!resolver,
  );

  if (active.length === 0) {
    return undefined;
  }

  return path => {
    for (const resolver of active) {
      const source = resolver(path);
      if (source) {
        return source;
      }
    }
    return undefined;
  };
}

/** Returns true when `expression` is a plain component property path. */
export function isComponentPathExpression(expression: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(expression.trim());
}
