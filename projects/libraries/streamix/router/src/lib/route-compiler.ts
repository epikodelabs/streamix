import type {
  StreamixLayout,
  StreamixRoute,
  StreamixRoutes,
} from './route-types';

export interface CompiledRoute {
  readonly route: StreamixRoute;
  readonly path: string;
  readonly redirectTo?: string;
  readonly layouts:
    readonly StreamixLayout[];
}

export function joinRoutePath(
  parent: string,
  child: string,
): string {
  const parentSegments =
    parent
      .split('/')
      .filter(Boolean);

  const childSegments =
    child
      .split('/')
      .filter(Boolean);

  const joined = [
    ...parentSegments,
    ...childSegments,
  ].join('/');

  return joined
    ? `/${joined}`
    : '/';
}

export function compileRedirect(
  parentPath: string,
  redirectTo:
    string | undefined,
): string | undefined {
  if (!redirectTo) {
    return undefined;
  }

  return redirectTo.startsWith('/')
    ? joinRoutePath('/', redirectTo)
    : joinRoutePath(
        parentPath,
        redirectTo,
      );
}

export function compileRoutes(
  entries: StreamixRoutes,
  parentPath = '/',
  layouts:
    readonly StreamixLayout[] = [],
  output: CompiledRoute[] = [],
): readonly CompiledRoute[] {
  for (const entry of entries) {
    if (entry.kind === 'layout') {
      compileRoutes(
        entry.entries,
        joinRoutePath(
          parentPath,
          entry.path,
        ),
        Object.freeze([
          ...layouts,
          entry,
        ]),
        output,
      );

      continue;
    }

    output.push({
      route: entry,
      path: joinRoutePath(
        parentPath,
        entry.path,
      ),
      redirectTo: compileRedirect(
        parentPath,
        entry.redirectTo,
      ),
      layouts,
    });
  }

  return output;
}

function normalizePattern(
  path: string,
): string {
  return path.replace(
    /:([A-Za-z_][A-Za-z0-9_]*)/g,
    ':',
  );
}

export interface RouteRegistryRecord {
  readonly route: StreamixRoute;
  readonly fullPath: string;
}

export interface RouteRegistry {
  readonly namedRoutes:
    ReadonlyMap<
      string,
      RouteRegistryRecord
    >;
}

export function createRouteRegistry(
  entries: StreamixRoutes,
): RouteRegistry {
  const namedRoutes =
    new Map<
      string,
      RouteRegistryRecord
    >();

  const literalPaths =
    new Map<string, StreamixRoute>();

  const patterns =
    new Map<string, string>();

  for (
    const {
      route,
      path,
    }
    of compileRoutes(entries)
  ) {
    const previous =
      literalPaths.get(path);

    if (previous) {
      throw new Error(
        `Duplicate compiled route path "${path}".`,
      );
    }

    literalPaths.set(path, route);

    const pattern =
      normalizePattern(path);

    const previousPattern =
      patterns.get(pattern);

    if (
      previousPattern &&
      previousPattern !== path
    ) {
      throw new Error(
        `Conflicting route patterns ` +
        `"${previousPattern}" and "${path}".`,
      );
    }

    patterns.set(pattern, path);

    if (!route.name) {
      continue;
    }

    if (
      namedRoutes.has(route.name)
    ) {
      throw new Error(
        `Duplicate route name ` +
        `"${route.name}". ` +
        'Route names must be globally unique.',
      );
    }

    namedRoutes.set(
      route.name,
      {
        route,
        fullPath: path,
      },
    );
  }

  return {
    namedRoutes,
  };
}
