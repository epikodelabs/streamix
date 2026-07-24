import {
  type InferParamType,
  type InferSearchType,
  type ParamSchema,
  type SearchSchema,
} from './search-schema';
import type { StreamixRoute, StreamixRoutes } from './streamix-router';

type SearchableRoute = StreamixRoute & {
  readonly paramsSchema?: Record<string, ParamSchema<unknown>>;
  readonly searchSchema?: Record<string, SearchSchema<unknown>>;
  readonly children?: readonly SearchableRoute[];
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

type RouteEntries<
  TRoutes,
  TPrefix extends string = '',
> = TRoutes extends readonly (infer TRoute)[]
  ? RouteEntry<TRoute, TPrefix>
  : never;

type RouteEntry<TRoute, TPrefix extends string> =
  TRoute extends {
    path: infer TPath extends string;
    children?: infer TChildren;
  }
    ? string extends TPath
      ? {
          readonly path: string;
          readonly route: TRoute;
        }
      :
          | {
              readonly path: JoinPath<TPrefix, TPath>;
              readonly route: TRoute;
            }
          | (TChildren extends readonly unknown[]
              ? RouteEntries<TChildren, JoinPath<TPrefix, TPath>>
              : never)
    : never;

type RouteSearch<TRoute> = TRoute extends { searchSchema: infer TSchema }
  ? TSchema extends Record<string, SearchSchema<unknown>>
    ? InferSearchType<TSchema>
    : never
  : never;

type RouteParamsFromSchema<TRoute, TPath extends string> =
  TRoute extends { paramsSchema: infer TSchema }
    ? TSchema extends Record<string, ParamSchema<unknown>>
      ? {
          [K in ExtractParam<TPath>]:
            K extends keyof InferParamType<TSchema>
              ? InferParamType<TSchema>[K]
              : string;
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

type RawTypedNavigate = (
  path: string,
  paramsOrOptions?:
    | Record<string, string>
    | TypedNavigateOptions<Record<string, unknown>>,
  options?: TypedNavigateOptions<Record<string, unknown>>,
) => Promise<boolean>;

type RawTypedHref = (
  path: string,
  paramsOrOptions?:
    | Record<string, string>
    | TypedHrefOptions<Record<string, unknown>>,
  options?: TypedHrefOptions<Record<string, unknown>>,
) => string;

type NavigateCall<
  TPath extends string,
  TRoute,
> = string extends TPath
  ? RawTypedNavigate
  : [ExtractParam<TPath>] extends [never]
  ? (
      path: TPath,
      options?: TypedNavigateOptions<RouteSearch<TRoute>>,
    ) => Promise<boolean>
  : (
      path: TPath,
      params: RouteParamsFromSchema<TRoute, TPath>,
      options?: TypedNavigateOptions<RouteSearch<TRoute>>,
    ) => Promise<boolean>;

type HrefCall<TPath extends string, TRoute> = string extends TPath
  ? RawTypedHref
  : [ExtractParam<TPath>] extends [never]
    ? (path: TPath, options?: TypedHrefOptions<RouteSearch<TRoute>>) => string
    : (
        path: TPath,
        params: RouteParamsFromSchema<TRoute, TPath>,
        options?: TypedHrefOptions<RouteSearch<TRoute>>,
      ) => string;

type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer TResult) => void
  ? TResult
  : never;

type NavigateEntry<TEntry> = TEntry extends {
  path: infer TPath extends string;
  route: infer TRoute;
}
  ? NavigateCall<TPath, TRoute>
  : never;

type HrefEntry<TEntry> = TEntry extends {
  path: infer TPath extends string;
  route: infer TRoute;
}
  ? HrefCall<TPath, TRoute>
  : never;

export type TypedNavigate<T extends StreamixRoutes> = UnionToIntersection<
  NavigateEntry<RouteEntries<T>>
>;

export type TypedHref<T extends StreamixRoutes> = UnionToIntersection<
  HrefEntry<RouteEntries<T>>
>;

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
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }

    const spec = schema[key];
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

export interface TypedRouter<T extends StreamixRoutes> {
  readonly navigate: TypedNavigate<T>;
  readonly href: TypedHref<T>;
}

export function createTypedRouter<T extends StreamixRoutes>(
  routes: T,
  navigate: (
    target: string | URL,
    options?: { replace?: boolean; state?: unknown },
  ) => Promise<boolean>,
  href: (target: string | URL) => string,
): TypedRouter<T> {
  const paramsSchemaMap = new Map<
    string,
    Record<string, ParamSchema<unknown>>
  >();
  const searchSchemaMap = new Map<
    string,
    Record<string, SearchSchema<unknown>>
  >();

  function collectSchemas(routesArray: SearchableRoutes, prefix = ''): void {
    for (const route of routesArray) {
      const fullPath = prefix ? `${prefix}/${route.path}` : route.path;

      if (route.paramsSchema) {
        paramsSchemaMap.set(fullPath, route.paramsSchema);
      }

      if (route.searchSchema) {
        searchSchemaMap.set(fullPath, route.searchSchema);
      }

      if (route.children) {
        collectSchemas(route.children, fullPath);
      }
    }
  }

  collectSchemas(routes as SearchableRoutes);

  function buildTarget(
    path: string,
    params?: Record<string, unknown>,
    search?: Record<string, unknown>,
  ): string {
    const paramsSchema = paramsSchemaMap.get(path);
    const serializedParams = paramsSchema && params
      ? serializeKnownParams(paramsSchema, params)
      : params as Record<string, string> | undefined;
    let target = serializedParams ? interpolatePath(path, serializedParams) : path;

    if (search && Object.keys(search).length > 0) {
      const schema = searchSchemaMap.get(path);

      if (schema) {
        target += serializeKnownSearch(schema, search);
      } else {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(search)) {
          if (value !== undefined) {
            searchParams.set(key, String(value));
          }
        }

        const serialized = searchParams.toString();
        if (serialized) {
          target += `?${serialized}`;
        }
      }
    }

    return target;
  }

  return {
    navigate: ((path: string, ...args: unknown[]) => {
      const params = hasPathParams(path)
        ? (args[0] as Record<string, unknown> | undefined)
        : undefined;
      const options = params
        ? (args[1] as TypedNavigateOptions | undefined)
        : (args[0] as TypedNavigateOptions | undefined);

      const target = buildTarget(
        path,
        params,
        options?.search as Record<string, unknown> | undefined,
      );

      return navigate(target, {
        replace: options?.replace,
        state: options?.state,
      });
    }) as TypedNavigate<T>,

    href: ((path: string, ...args: unknown[]) => {
      const params = hasPathParams(path)
        ? (args[0] as Record<string, unknown> | undefined)
        : undefined;
      const options = params
        ? (args[1] as TypedHrefOptions | undefined)
        : (args[0] as TypedHrefOptions | undefined);

      const target = buildTarget(
        path,
        params,
        options?.search as Record<string, unknown> | undefined,
      );

      return href(target);
    }) as TypedHref<T>,
  };
}
