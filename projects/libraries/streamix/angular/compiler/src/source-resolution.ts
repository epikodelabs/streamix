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
export type SxReactiveSourceResolver = {
  (path: string): string | undefined;
  /** Tests whether a source's wrapped value declares a conflicting member. */
  hasValueMember?(path: string, member: string): boolean;
};

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

/** Escapes one scope key for a generated single-quoted string literal. */
function scopeKeyLiteral(segment: string): string {
  return `'${segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Public atom accessor for a dotted member path. Nested scopes expose their
 * own `get`, so `user.name` becomes `model.get('user').get('name')`; the
 * Scope API does not resolve dotted keys.
 */
function scopeMemberAccess(scopePath: string, member: string): string {
  if (!member) return scopePath;
  return member
    .split('.')
    .reduce((access, segment) => `${access}.get(${scopeKeyLiteral(segment)})`, scopePath);
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
      mappings[`${scopePath}.${member}`] = scopeMemberAccess(scopePath, member);
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
      const segments = member.split('.');
      const last = segments[segments.length - 1];
      const parent = scopeMemberAccess(scopePath, segments.slice(0, -1).join('.'));
      mappings[`${scopePath}.${member}`] = {
        source: scopeMemberAccess(scopePath, member),
        write: value => `ctx.${parent}.set(${scopeKeyLiteral(last)}, ${value})`,
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

  const combined: SxReactiveSourceResolver = path => {
    for (const resolver of active) {
      const source = resolver(path);
      if (source) {
        return source;
      }
    }
    return undefined;
  };
  combined.hasValueMember = (path, member) =>
    active.find(resolve => resolve(path) !== undefined)?.hasValueMember?.(path, member) ?? false;
  return combined;
}
