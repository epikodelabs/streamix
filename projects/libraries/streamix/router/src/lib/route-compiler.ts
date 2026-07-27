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

export interface CompiledRouteGroup {
  readonly path: string;
  readonly layouts: readonly StreamixLayout[];
  readonly primary: CompiledRoute;
  readonly outlets: readonly CompiledRoute[];
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

  if (
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(redirectTo) ||
    redirectTo.startsWith('//')
  ) {
    return redirectTo;
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
  output: CompiledRoute[] = []
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

export function groupRoutes(
  compiled: readonly CompiledRoute[],
): readonly CompiledRouteGroup[] {
  const groups = new Map<string, CompiledRouteGroup>();

  for (const route of compiled) {
    const key = `${route.path}#${route.layouts.map(l => l.path).join('/')}`;
    let group = groups.get(key);

    if (!group) {
      if (route.route.outlet) {
        throw new Error(
          `Named outlet route "${route.route.name ?? route.path}" with path "${route.path}" has no corresponding primary outlet route with the same path.`,
        );
      }

      group = {
        path: route.path,
        layouts: route.layouts,
        primary: route,
        outlets: [],
      };

      groups.set(key, group);
    } else if (!route.route.outlet) {
      throw new Error(
        `Duplicate primary route for path "${route.path}" under the same layout chain.`,
      );
    } else {
      group = {
        ...group,
        outlets: [...group.outlets, route],
      };

      groups.set(key, group);
    }
  }

  return Array.from(groups.values());
}

function validateRouteGroups(
  groups: readonly CompiledRouteGroup[],
): void {
  const names = new Set<string>();

  for (const group of groups) {
    const primaryName = group.primary.route.name;
    if (primaryName) {
      if (names.has(primaryName)) {
        throw new Error(`Duplicate route name "${primaryName}". Route names must be globally unique.`);
      }
      names.add(primaryName);
    }

    if (group.primary.redirectTo && group.outlets.length > 0) {
      throw new Error(
        `A redirect route cannot have named outlets. Path: "${group.path}"`,
      );
    }

    const outletNames = new Set<string>();
    for (const outlet of group.outlets) {
      const outletName = outlet.route.outlet!;
      if (outletNames.has(outletName)) {
        throw new Error(
          `Duplicate outlet named "${outletName}" for route path "${group.path}".`,
        );
      }
      outletNames.add(outletName);

      if (outlet.route.name) {
        throw new Error(
          `Named outlet routes cannot have a "name" property. Route path: "${group.path}", outlet: "${outletName}"`,
        );
      }

      if (outlet.redirectTo) {
        throw new Error(
          `Named outlet routes cannot be redirects. Route path: "${group.path}", outlet: "${outletName}"`,
        );
      }

      if (outlet.route.paramsSchema || outlet.route.querySchema) {
        throw new Error('Named outlet routes cannot define paramsSchema or querySchema.');
      }

      if (outlet.route.viewTransition !== undefined) {
        throw new Error('Named outlet routes cannot define viewTransition.');
      }

      if (outlet.route.preload !== undefined) {
        throw new Error('Named outlet routes cannot define preload.');
      }
    }
  }
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
  readonly groups:
    readonly CompiledRouteGroup[];
}

export function createRouteRegistry(
  entries: StreamixRoutes,
): RouteRegistry {
  const namedRoutes =
    new Map<
      string,
      RouteRegistryRecord
    >();
  
  const groups = groupRoutes(compileRoutes(entries));
  validateRouteGroups(groups);
  
  const literalPaths =
    new Map<string, StreamixRoute>();

  const patterns =
    new Map<string, string>();

  for (
    const {
      route,
      path,
    } of groups.flatMap(g => [g.primary, ...g.outlets])
  ) {
    const previous =
      literalPaths.get(path);

    if (previous && !previous.outlet && !route.outlet) {
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
    groups,
  };
}
