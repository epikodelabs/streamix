import type {
  StreamixLayout,
  StreamixRoute,
  StreamixRoutes,
} from './route-types';

export const PRIMARY_OUTLET = '';

export interface CompiledRoute {
  readonly route: StreamixRoute;
  readonly path: string;
  readonly redirectTo?: string;
  readonly layouts: readonly StreamixLayout[];
}

export interface CompiledRouteGroup {
  readonly path: string;
  readonly layouts: readonly StreamixLayout[];
  readonly primary: CompiledRoute;
  readonly outlets: readonly CompiledRoute[];
}

export function normalizeOutletName(
  outlet: string | undefined,
): string {
  return outlet?.trim() ?? PRIMARY_OUTLET;
}

export function joinRoutePath(
  parent: string,
  child: string,
): string {
  const parentSegments = parent.split('/').filter(Boolean);
  const childSegments = child.split('/').filter(Boolean);
  const joined = [...parentSegments, ...childSegments].join('/');
  return joined ? `/${joined}` : '/';
}

export function compileRedirect(
  parentPath: string,
  redirectTo: string | undefined,
): string | undefined {
  if (!redirectTo) return undefined;

  if (
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(redirectTo) ||
    redirectTo.startsWith('//')
  ) {
    return redirectTo;
  }

  return redirectTo.startsWith('/')
    ? joinRoutePath('/', redirectTo)
    : joinRoutePath(parentPath, redirectTo);
}

function flattenRoutes(
  entries: StreamixRoutes,
  parentPath = '/',
  layouts: readonly StreamixLayout[] = [],
  output: CompiledRoute[] = [],
): readonly CompiledRoute[] {
  for (const entry of entries) {
    if (entry.kind === 'layout') {
      flattenRoutes(
        entry.entries,
        joinRoutePath(parentPath, entry.path),
        Object.freeze([...layouts, entry]),
        output,
      );
      continue;
    }

    output.push({
      route: entry,
      path: joinRoutePath(parentPath, entry.path),
      redirectTo: compileRedirect(parentPath, entry.redirectTo),
      layouts,
    });
  }

  return output;
}

function sameLayoutChain(
  left: readonly StreamixLayout[],
  right: readonly StreamixLayout[],
): boolean {
  return left.length === right.length &&
    left.every((layout, index) => layout === right[index]);
}

export function compileRoutes(
  entries: StreamixRoutes,
): readonly CompiledRouteGroup[] {
  const groups = new Map<string, {
    layouts: readonly StreamixLayout[];
    routes: Map<string, CompiledRoute>;
  }>();

  for (const compiled of flattenRoutes(entries)) {
    const outlet = normalizeOutletName(compiled.route.outlet);
    const current = groups.get(compiled.path);

    if (!current) {
      groups.set(compiled.path, {
        layouts: compiled.layouts,
        routes: new Map([[outlet, compiled]]),
      });
      continue;
    }

    if (!sameLayoutChain(current.layouts, compiled.layouts)) {
      throw new Error(
        `Compiled route path "${compiled.path}" is declared under different layout branches. ` +
        'Named outlets must belong to the same layout branch.',
      );
    }

    if (current.routes.has(outlet)) {
      throw new Error(
        `Duplicate compiled route for path "${compiled.path}" and outlet ` +
        `"${outlet || 'primary'}".`,
      );
    }

    current.routes.set(outlet, compiled);
  }

  const output: CompiledRouteGroup[] = [];

  for (const [path, group] of groups) {
    const primary = group.routes.get(PRIMARY_OUTLET);

    if (!primary) {
      throw new Error(
        `Route group "${path}" has named outlets but no primary route.`,
      );
    }

    const outlets = [...group.routes.entries()]
      .filter(([name]) => name !== PRIMARY_OUTLET)
      .map(([, route]) => route);

    for (const outlet of outlets) {
      if (outlet.route.name) {
        throw new Error(
          `Named outlet route "${path}" (${normalizeOutletName(outlet.route.outlet)}) ` +
          'cannot define a route name. Only primary routes are navigable.',
        );
      }

      if (outlet.redirectTo) {
        throw new Error(
          `Named outlet route "${path}" (${normalizeOutletName(outlet.route.outlet)}) ` +
          'cannot redirect independently.',
        );
      }
    }

    if (primary.redirectTo && outlets.length > 0) {
      throw new Error(
        `Redirect route "${path}" cannot have named outlet routes.`,
      );
    }

    output.push(Object.freeze({
      path,
      layouts: group.layouts,
      primary,
      outlets: Object.freeze(outlets),
    }));
  }

  return Object.freeze(output);
}

function normalizePattern(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, ':');
}

export interface RouteRegistryRecord {
  readonly route: StreamixRoute;
  readonly fullPath: string;
}

export interface RouteRegistry {
  readonly namedRoutes: ReadonlyMap<string, RouteRegistryRecord>;
}

export function createRouteRegistry(entries: StreamixRoutes): RouteRegistry {
  const namedRoutes = new Map<string, RouteRegistryRecord>();
  const patterns = new Map<string, string>();

  for (const group of compileRoutes(entries)) {
    const pattern = normalizePattern(group.path);
    const previousPattern = patterns.get(pattern);

    if (previousPattern && previousPattern !== group.path) {
      throw new Error(
        `Conflicting route patterns "${previousPattern}" and "${group.path}".`,
      );
    }

    patterns.set(pattern, group.path);

    const route = group.primary.route;
    if (!route.name) continue;

    if (namedRoutes.has(route.name)) {
      throw new Error(
        `Duplicate route name "${route.name}". Route names must be globally unique.`,
      );
    }

    namedRoutes.set(route.name, { route, fullPath: group.path });
  }

  return { namedRoutes };
}
