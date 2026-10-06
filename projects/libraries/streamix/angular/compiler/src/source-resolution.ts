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
 * - `model.count` -> `model.count` for an atom-first Scope member.
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
 * upstream type checker. Each value maps to its public atom accessor.
 */
export function createScopeValuePathResolver(
  scopes: Readonly<Record<string, readonly string[]>>,
): SxReactiveSourceResolver {
  const mappings: Record<string, string> = {};

  for (const [scopePath, members] of Object.entries(scopes)) {
    for (const member of members) {
      const property = member.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      mappings[`${scopePath}.${member}`] =
        `${scopePath}.get('${property}')`;
    }
  }

  return createReactiveSourcePathResolver(mappings);
}

/**
 * Compile-time mapping from a value-facing template path to the writable
 * source behind it: the atom expression to read, and how to write it back for
 * a two-way binding.
 */
export interface SxReactiveWritable {
  /** Atom expression, for example `model.get('name')`. */
  readonly source: string;
  /** Statement text that stores `valueExpression` back into the source. */
  write(valueExpression: string): string;
}

export type SxReactiveWritableResolver = (
  path: string,
) => SxReactiveWritable | undefined;

/** Creates a resolver for standalone writable atom fields. */
export function createWritableSourcePathResolver(
  paths: Iterable<string>,
): SxReactiveWritableResolver {
  const sources = new Set(paths);

  return path =>
    sources.has(path)
      ? {
          source: path,
          write: value => `ctx.${path}.set(${value})`,
        }
      : undefined;
}

/**
 * Creates scope-member writable mappings. Only members that hold a writable
 * atom may appear: writing a derived member throws at runtime.
 */
export function createScopeWritableResolver(
  scopes: Readonly<Record<string, readonly string[]>>,
): SxReactiveWritableResolver {
  const mappings: Record<string, SxReactiveWritable> = {};

  for (const [scopePath, members] of Object.entries(scopes)) {
    for (const member of members) {
      const property = member.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      mappings[`${scopePath}.${member}`] = {
        source: `${scopePath}.get('${property}')`,
        write: value => `ctx.${scopePath}.set('${property}', ${value})`,
      };
    }
  }

  return path => mappings[path];
}

/** Combines writable resolvers in priority order. */
export function combineReactiveWritableResolvers(
  ...resolvers: Array<SxReactiveWritableResolver | undefined>
): SxReactiveWritableResolver | undefined {
  const active = resolvers.filter(
    (resolver): resolver is SxReactiveWritableResolver => !!resolver,
  );

  if (active.length === 0) {
    return undefined;
  }

  return path => {
    for (const resolver of active) {
      const writable = resolver(path);

      if (writable) {
        return writable;
      }
    }

    return undefined;
  };
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
