import type {
  InferParamType,
  InferQueryType,
  ParamSchemaRecord,
  QuerySchemaRecord,
} from './query-schema';
import type {
  StreamixRoute, StreamixRoutes
} from './route-types';

/**
 * Extracts named parameter tokens from path string templates (e.g. "/users/:id")
 */
export type ExtractPathParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ExtractPathParams<`/${Rest}`>
    : T extends `${string}:${infer Param}`
    ? Param
    : never;

/**
 * Recursively flattens all routes and layout entries into a union of leaf routes.
 */
export type StreamixLeafRoutes<TRoutes extends StreamixRoutes> =
  TRoutes[number] extends infer TEntry ? TEntry extends { kind: 'route' } ? TEntry : TEntry extends { kind: 'layout', entries: infer TEntries extends StreamixRoutes } ? StreamixLeafRoutes<TEntries> : never : never;

type RouteName<TRoute> = TRoute extends StreamixRoute<
  string,
  infer TName,
  ParamSchemaRecord | undefined,
  QuerySchemaRecord | undefined
>
  ? Extract<TName, string>
  : never;

/**
 * Extracts route names safely across layout entries without deep recursion.
 */
export type ExtractRouteNames<TRoutes extends StreamixRoutes> =
  RouteName<StreamixLeafRoutes<TRoutes>>;

/**
 * Infers route path parameter types from paramsSchema or path template tokens.
 */
export type InferRouteParams<TRoute> = TRoute extends { paramsSchema: ParamSchemaRecord }
  ? InferParamType<TRoute['paramsSchema']>
  : TRoute extends { path: infer P extends string }
  ? [ExtractPathParams<P>] extends [never]
    ? Record<string, never>
    : Record<ExtractPathParams<P>, string | number>
  : Record<string, unknown>;

/**
 * Infers route query parameter types from querySchema or searchSchema.
 */
export type InferRouteQuery<TRoute> = TRoute extends {
  querySchema: infer TSchema extends QuerySchemaRecord;
}
  ? InferQueryType<TSchema>
  : Record<string, unknown>;

type HasRequiredParams<TRoute> =
  InferRouteParams<TRoute> extends infer TParams
    ? keyof TParams extends never
      ? false
      : TParams extends Record<string, never>
      ? false
      : true
    : false;

/**
 * Maps options (params, query, search, navigation state) for a target route name.
 */
export type RouteOptionsByName<
  TRoutes extends StreamixRoutes,
  TName extends string,
> = StreamixLeafRoutes<TRoutes> extends infer TRoute
  ? TRoute extends StreamixRoute<string, TName, any, any>
    ? HasRequiredParams<TRoute> extends true
      ? {
          readonly params: InferRouteParams<TRoute>;
          readonly query?: InferRouteQuery<TRoute>;
          readonly state?: unknown;
          readonly replace?: boolean;
        }
      : {
          readonly params?: InferRouteParams<TRoute>;
          readonly query?: InferRouteQuery<TRoute>;
          readonly state?: unknown;
          readonly replace?: boolean;
        }
    : never
  : never;

/**
 * Strongly-typed navigation proxy for StreamixRouter.
 */
export type TypedNavigate<TRoutes extends StreamixRoutes> = {
  [K in ExtractRouteNames<TRoutes>]: (
    options?: RouteOptionsByName<TRoutes, K>,
  ) => Promise<boolean>;
};

/**
 * Strongly-typed href generator proxy for StreamixRouter.
 */
export type TypedHref<TRoutes extends StreamixRoutes> = {
  [K in ExtractRouteNames<TRoutes>]: (
    options?: RouteOptionsByName<TRoutes, K>,
  ) => string | null;
};