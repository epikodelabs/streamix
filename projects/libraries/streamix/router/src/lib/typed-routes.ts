import {
  type InferParamType,
  type InferSearchType,
  type ParamSchema,
  type SearchSchema
} from './search-schema';
import type { StreamixRoute, StreamixRoutes } from './streamix-router';

type SearchableRoute = StreamixRoute & {
  readonly paramsSchema?: Record<string, ParamSchema<unknown>>;
  readonly searchSchema?: Record<string, SearchSchema<unknown>>;
};

type SearchableRoutes = readonly SearchableRoute[];

type ExtractParam<T extends string> =
  T extends `${infer _Start}:${infer TParam}/${infer TRest}`
    ? TParam | ExtractParam<TRest>
    : T extends `${infer _Start}:${infer TParam}`
      ? TParam
      : never;

type ParamsFromPath<T extends string> = {
  [K in ExtractParam<T>]: string;
};

type JoinPath<TPrefix extends string, TSegment extends string> =
  TPrefix extends ''
    ? TSegment
    : TSegment extends ''
      ? TPrefix
      : `${TPrefix}/${TSegment}`;

type RouteEntries<TRoutes> = TRoutes extends readonly (infer TRoute)[]
  ? TRoute extends { path: infer TPath extends string }
    ? { readonly path: TPath; readonly route: TRoute }
    : never
  : never;

type RouteSearch<TRoute> = TRoute extends { searchSchema: infer TSchema }
  ? TSchema extends Record<string, SearchSchema<unknown>>
    ? InferSearchType<TSchema>
    : never
  : never;

type RouteParamsFromSchema<TRoute, TPath extends string> = TRoute extends {
  paramsSchema: infer TSchema;
}
  ? TSchema extends Record<string, ParamSchema<unknown>>
    ? {
        [K in ExtractParam<TPath>]: K extends keyof InferParamType<TSchema> ? InferParamType<TSchema>[K] : string;
      }
    : ParamsFromPath<TPath>
  : ParamsFromPath<TPath>;

export interface TypedNavigateOptions<TSearch = never> {
  replace?: boolean;
  state?: unknown;
  search?: TSearch extends never ? never : Partial<TSearch>;
}

export interface TypedHrefOptions<TSearch = never> {
  search?: TSearch extends never ? never : Partial<TSearch>;
}

type NavigateCall<TPath extends string, TRoute> = [
  ExtractParam<TPath>,
] extends [never]
  ? (options?: TypedNavigateOptions<RouteSearch<TRoute>>) => Promise<boolean>
  : (
      params: RouteParamsFromSchema<TRoute, TPath>,
      options?: TypedNavigateOptions<RouteSearch<TRoute>>,
    ) => Promise<boolean>;

type HrefCall<TPath extends string, TRoute> = [
  ExtractParam<TPath>,
] extends [never]
  ? (options?: TypedHrefOptions<RouteSearch<TRoute>>) => string
  : (
      params: RouteParamsFromSchema<TRoute, TPath>,
      options?: TypedHrefOptions<RouteSearch<TRoute>>,
    ) => string;

type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer TResult) => void
  ? TResult
  : never;

type NavigateEntry<TEntry> = TEntry extends {
  readonly name: infer TName extends string;
  readonly fullPath: infer TPath extends string;
  readonly route: infer TRoute;
}
  ? {
      readonly [K in TName]: NavigateCall<TPath, TRoute>;
    }
  : never;

type HrefEntry<TEntry> = TEntry extends {
  readonly name: infer TName extends string;
  readonly fullPath: infer TPath extends string;
  readonly route: infer TRoute;
}
  ? {
      readonly [K in TName]: HrefCall<TPath, TRoute>;
    }
  : never;

export type TypedNavigate<T extends StreamixRoutes> = UnionToIntersection<
  NavigateEntry<RouteEntries<T>>
>;

export type TypedHref<T extends StreamixRoutes> = UnionToIntersection<
  HrefEntry<RouteEntries<T>>
>;

export interface TypedRouter<T extends StreamixRoutes> {
  readonly navigate: TypedNavigate<T>;
  readonly href: TypedHref<T>;
}

interface NamedRouteRecord {
  readonly path: string;
  readonly route: SearchableRoute;
}

function interpolatePath(path: string, params: Record<string, string>): string {
  return path.replace(/:([a-zA-Z0-9_]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`Missing required parameter ":${key}" for path "${path}"`);
    }
    return encodeURIComponent(value);
  });
}

function hasPathParams(path: string): boolean {
  return /:([a-zA-Z0-9_]+)/.test(path);
}

function serializeKnownSearch(
  schema: Record<string, SearchSchema<unknown>>,
  values: Record<string, unknown>,
): string {
  const serialized = serializeUnknownSearch(values, schema);
  return serialized ? `?${serialized}` : '';
}

function serializeUnknownSearch(values: Record<string, unknown>, schema?: Record<string, SearchSchema<unknown>>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }

    const spec = schema?.[key];
    if (!spec) {
      continue;
    }

    if (spec._type === 'array' && Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item));
      }
      continue;
    }

    if (spec._type === 'date' && value instanceof Date) {
      searchParams.set(key, value.toISOString());
      continue;
    }

    searchParams.set(key, String(value));
  }

  const serialized = searchParams.toString();
  return serialized ? `?${serialized}` : '';
}

function joinRoutePath(prefix: string, segment: string): string {
  const joined = [prefix, segment].filter(Boolean).join('/');

  return joined.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function serializeKnownParams(
  schema: Record<string, ParamSchema<unknown>>,
  values: Record<string, unknown>,
): Record<string, string> {
  const params: Record<string, string> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }

    const spec = schema[key];
    if (!spec) {
      params[key] = String(value);
      continue;
    }

    if (spec._type === 'optional') {
      if (spec.inner._type === 'date' && value instanceof Date) {
        params[key] = value.toISOString();
      } else if (spec.inner._type === 'boolean') {
        params[key] = value ? 'true' : 'false';
      } else {
        params[key] = String(value);
      }
      continue;
    }

    if (spec._type === 'date' && value instanceof Date) {
      params[key] = value.toISOString();
      continue;
    }

    if (spec._type === 'boolean') {
      params[key] = value ? 'true' : 'false';
      continue;
    }

    params[key] = String(value);
  }

  return params;
}

export function createTypedRouter<T extends StreamixRoutes>(
  routes: T,
  navigate: (
    target: string | URL,
    options?: { replace?: boolean; state?: unknown },
  ) => Promise<boolean>,
  href: (target: string | URL) => string,
): TypedRouter<T> {
  const routeMap = new Map<string, { path: string; route: SearchableRoute }>();
  const collectRoutes = (routeList: SearchableRoutes, prefix = ''): void => {
    for (const route of routeList) {
      const fullPath = joinRoutePath(prefix, route.path);

      if (route.name) {
        if (routeMap.has(route.name)) {
          throw new Error(
            `[StreamixRouter] Duplicate route name "${route.name}". Route names must be unique.`,
          );
        }

        routeMap.set(route.name, {
          path: fullPath,
          route,
        });
      }

      if (route.children) {
        collectRoutes(route.children, fullPath);
      }
    }
  };

  collectRoutes(routes as SearchableRoutes);

  const resolveRoute = (name: PropertyKey): NamedRouteRecord => {
    if (typeof name !== 'string') {
      throw new TypeError('Route names must be strings.');
    }

    const record = routeMap.get(name);

    if (!record) {
      throw new Error(`[StreamixRouter] No route named "${name}".`);
    }

    return record;
  };

  function buildTarget(
    record: NamedRouteRecord,
    params?: Record<string, unknown>,
    search?: Record<string, unknown>,
  ): string {
    const serializedParams =
      record.route.paramsSchema && params
        ? serializeKnownParams(record.route.paramsSchema, params)
        : params
        ? Object.fromEntries(
            Object.entries(params)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [key, String(value)]),
          )
        : undefined;

    let target = hasPathParams(record.path)
      ? interpolatePath(record.path, serializedParams ?? {})
      : record.path;

    if (search && Object.keys(search).length > 0) {
      target += record.route.searchSchema
        ? serializeKnownSearch(record.route.searchSchema, search)
        : serializeUnknownSearch(search);
    }

    return target;
  }

  const namedNavigate = new Proxy(Object.create(null), {
    get(_, name: PropertyKey) {
      if (name === 'then' || name === 'toJSON' || name === 'inspect') {
        return undefined;
      }

      return (...args: unknown[]) => {
        const record = resolveRoute(name);
        const parameterized = hasPathParams(record.path);

        const params = parameterized
          ? (args[0] as Record<string, unknown> | undefined)
          : undefined;

        const options = (
          parameterized ? args[1] : args[0]
        ) as TypedNavigateOptions<Record<string, unknown>> | undefined;

        const target = buildTarget(record, params, options?.search);

        return navigate(target, {
          replace: options?.replace,
          state: options?.state,
        });
      };
    },
  }) as TypedNavigate<T>;

  const namedHref = new Proxy(Object.create(null), {
    get(_, name: PropertyKey) {
      if (name === 'then' || name === 'toJSON' || name === 'inspect') {
        return undefined;
      }

      return (...args: unknown[]) => {
        const record = resolveRoute(name);
        const parameterized = hasPathParams(record.path);

        const params = parameterized
          ? (args[0] as Record<string, unknown> | undefined)
          : undefined;

        const options = (
          parameterized ? args[1] : args[0]
        ) as TypedHrefOptions<Record<string, unknown>> | undefined;

        return href(buildTarget(record, params, options?.search));
      };
    },
  }) as TypedHref<T>;

  return {
    navigate: namedNavigate,
    href: namedHref,
  };
}