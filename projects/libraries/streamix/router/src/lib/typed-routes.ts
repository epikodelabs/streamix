import type {
  InferParamType,
  InferSearchType,
  ParamSchema,
  SearchSchema,
} from './search-schema';

import type {
  StreamixRoutes,
} from './route-types';

type TrimLeadingSlash<
  TPath extends string,
> =
  TPath extends `/${infer TRest}`
    ? TrimLeadingSlash<TRest>
    : TPath;

type TrimTrailingSlash<
  TPath extends string,
> =
  TPath extends `${infer TRest}/`
    ? TrimTrailingSlash<TRest>
    : TPath;

type NormalizeSegment<
  TPath extends string,
> =
  TrimTrailingSlash<
    TrimLeadingSlash<TPath>
  >;

export type JoinRoutePath<
  TParent extends string,
  TChild extends string,
> =
  NormalizeSegment<TParent> extends
    infer TParentPart extends string
      ? NormalizeSegment<TChild> extends
          infer TChildPart extends string
        ? TParentPart extends ''
          ? TChildPart extends ''
            ? '/'
            : `/${TChildPart}`
          : TChildPart extends ''
            ? `/${TParentPart}`
            : `/${TParentPart}/${TChildPart}`
        : never
      : never;

export interface CompiledRouteType<
  TRoute,
  TPath extends string,
> {
  readonly route: TRoute;
  readonly path: TPath;
}

type CompileEntry<
  TEntry,
  TParentPath extends string,
> =
  TEntry extends {
    readonly kind: 'layout';
    readonly path:
      infer TLayoutPath extends string;
    readonly entries:
      infer TEntries extends
        readonly unknown[];
  }
    ? CompileEntries<
        TEntries,
        JoinRoutePath<
          TParentPath,
          TLayoutPath
        >
      >
    : TEntry extends {
        readonly kind: 'route';
        readonly path:
          infer TRoutePath extends string;
      }
      ? CompiledRouteType<
          TEntry,
          JoinRoutePath<
            TParentPath,
            TRoutePath
          >
        >
      : never;

export type CompileEntries<
  TEntries,
  TParentPath extends string = '/',
> =
  TEntries extends readonly unknown[]
    ? {
        [K in keyof TEntries]:
          CompileEntry<
            TEntries[K],
            TParentPath
          >
      }[number]
    : never;

export type RouteNames<
  TRoutes extends StreamixRoutes,
> =
  CompileEntries<TRoutes> extends
    infer TEntry
      ? TEntry extends {
          readonly route: {
            readonly name:
              infer TName extends string;
          };
        }
        ? TName
        : never
      : never;

export type CompiledRouteByName<
  TRoutes extends StreamixRoutes,
  TName extends string,
> =
  Extract<
    CompileEntries<TRoutes>,
    {
      readonly route: {
        readonly name: TName;
      };
    }
  >;

type StripParamModifier<
  TName extends string,
> =
  TName extends `${infer TBase}?`
    ? TBase
    : TName extends `${infer TBase}*`
      ? TBase
      : TName;

export type ExtractPathParams<
  TPath extends string,
> =
  TPath extends
    `${string}:${infer TParam}/${infer TRest}`
      ? StripParamModifier<TParam> |
          ExtractPathParams<`/${TRest}`>
      : TPath extends
          `${string}:${infer TParam}`
        ? StripParamModifier<TParam>
        : never;

type RouteParamSchema<
  TRoute,
> =
  TRoute extends {
    readonly paramsSchema?:
      infer TSchema;
  }
    ? Exclude<TSchema, undefined>
    : never;

type RouteSearchSchema<
  TRoute,
> =
  TRoute extends {
    readonly searchSchema?:
      infer TSchema;
  }
    ? Exclude<TSchema, undefined>
    : never;

type SchemaParams<
  TRoute,
> =
  [RouteParamSchema<TRoute>] extends
    [never]
      ? {}
      : RouteParamSchema<TRoute> extends
          Record<
            string,
            ParamSchema<unknown>
          >
        ? InferParamType<
            RouteParamSchema<TRoute>
          >
        : {};

type PathParams<
  TPath extends string,
  TRoute,
> = {
  [K in ExtractPathParams<TPath>]:
    K extends keyof SchemaParams<TRoute>
      ? SchemaParams<TRoute>[K]
      : string;
};

type SearchValues<
  TRoute,
> =
  [RouteSearchSchema<TRoute>] extends
    [never]
      ? never
      : RouteSearchSchema<TRoute> extends
          Record<
            string,
            SearchSchema<unknown>
          >
        ? Partial<
            InferSearchType<
              RouteSearchSchema<TRoute>
            >
          >
        : never;

type HasParams<
  TPath extends string,
> =
  [ExtractPathParams<TPath>] extends
    [never]
      ? false
      : true;

type HasSearch<
  TRoute,
> =
  [SearchValues<TRoute>] extends
    [never]
      ? false
      : true;

export type NamedRouteOptions<
  TEntry,
> =
  TEntry extends {
    readonly path:
      infer TPath extends string;
    readonly route:
      infer TRoute;
  }
    ? (
        HasParams<TPath> extends true
          ? {
              readonly params:
                PathParams<
                  TPath,
                  TRoute
                >;
            }
          : {
              readonly params?: never;
            }
      ) &
      (
        HasSearch<TRoute> extends true
          ? {
              readonly search?:
                SearchValues<TRoute>;
            }
          : {
              readonly search?: never;
            }
      )
    : never;

type NavigateCall<
  TEntry,
> =
  TEntry extends {
    readonly path:
      infer TPath extends string;
  }
    ? HasParams<TPath> extends true
      ? (
          options:
            NamedRouteOptions<TEntry>,
        ) => Promise<boolean>
      : (
          options?:
            NamedRouteOptions<TEntry>,
        ) => Promise<boolean>
    : never;

type HrefCall<
  TEntry,
> =
  TEntry extends {
    readonly path:
      infer TPath extends string;
  }
    ? HasParams<TPath> extends true
      ? (
          options:
            NamedRouteOptions<TEntry>,
        ) => string | null
      : (
          options?:
            NamedRouteOptions<TEntry>,
        ) => string | null
    : never;

export type TypedNavigate<
  TRoutes extends StreamixRoutes,
> = {
  [TName in RouteNames<TRoutes>]:
    NavigateCall<
      CompiledRouteByName<
        TRoutes,
        TName
      >
    >;
};

export type TypedHref<
  TRoutes extends StreamixRoutes,
> = {
  [TName in RouteNames<TRoutes>]:
    HrefCall<
      CompiledRouteByName<
        TRoutes,
        TName
      >
    >;
};
