import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type { ParamSchemaRecord, QuerySchemaRecord } from './query-schema';
import type { DeactivationContext, NavigationContext } from './vanilla-router';

export type MaybePromise<T> = T | PromiseLike<T>;
export type Lazy<T> = () => MaybePromise<T | { readonly default: T }>;

export type StreamixRouteProvider = Provider | EnvironmentProviders;
export type StreamixRouteProviders = readonly StreamixRouteProvider[];

export type RouteRedirect = {
  readonly redirectTo: string | URL;
  readonly replace?: boolean;
};

export type BeforeEnter = (
  context: NavigationContext,
) => MaybePromise<boolean | string | URL | RouteRedirect>;

export type BeforeLeave = (
  context: DeactivationContext,
) => MaybePromise<boolean | string | URL | RouteRedirect>;

export type RouteLoader<T = unknown> = (
  context: NavigationContext,
) => MaybePromise<T>;

export type RouteLoaders = Readonly<Record<string, RouteLoader>>;

export type StreamixRouteOptions<
  TName extends string | undefined = string | undefined,
  TParamsSchema extends ParamSchemaRecord | undefined = ParamSchemaRecord | undefined,
  TQuerySchema extends QuerySchemaRecord | undefined = QuerySchemaRecord | undefined,
> = Omit<
  StreamixRoute<string, TName, TParamsSchema, TQuerySchema>,
  'kind' | 'path' | 'component' | 'loadComponent'
>;

export interface StreamixRoute<
  TPath extends string = string,
  TName extends string | undefined = string | undefined,
  TParamsSchema extends ParamSchemaRecord | undefined = ParamSchemaRecord | undefined,
  TQuerySchema extends QuerySchemaRecord | undefined = QuerySchemaRecord | undefined,
> {
  readonly kind: 'route';
  readonly path: TPath;
  readonly name?: TName;
  readonly redirectTo?: string;
  readonly outlet?: string;
  readonly preload?: boolean;
  readonly component?: Type<unknown>;
  readonly viewTransition?: boolean;
  readonly paramsSchema?: TParamsSchema;
  readonly querySchema?: TQuerySchema;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly loadComponent?: Lazy<Type<unknown>>;
  readonly providers?: StreamixRouteProviders;
  readonly beforeEnter?: readonly BeforeEnter[];
  readonly beforeLeave?: readonly BeforeLeave[];
  readonly resolve?: RouteLoaders;
}

export type StreamixLayoutOptions = Omit<
  StreamixLayout,
  'kind' | 'path' | 'component' | 'loadComponent' | 'entries'
>;

export interface StreamixLayout<
  TPath extends string = string,
  TEntries extends StreamixRoutes = StreamixRoutes,
> {
  readonly kind: 'layout';
  readonly path: TPath;
  readonly component?: Type<unknown>;
  readonly loadComponent?: Lazy<Type<unknown>>;
  readonly entries: TEntries;
  readonly providers?: StreamixRouteProviders;
}

// Any-instantiated route/layout primitives to avoid undefined-widening issues
export type AnyStreamixRoute = StreamixRoute<any, any, any, any>;
export type AnyStreamixLayout = StreamixLayout<any, any>;

export type StreamixRouteEntry = AnyStreamixRoute | AnyStreamixLayout;
export type StreamixRoutes = readonly StreamixRouteEntry[];