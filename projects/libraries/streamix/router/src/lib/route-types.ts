import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type { ParamSchemaRecord, SearchSchemaRecord } from './search-schema';
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
  TName extends string | undefined = undefined,
  TParamsSchema extends ParamSchemaRecord | undefined = undefined,
  TSearchSchema extends SearchSchemaRecord | undefined = undefined,
> = Omit<
  StreamixRoute<string, TName, TParamsSchema, TSearchSchema>,
  'kind' | 'path' | 'component' | 'loadComponent'
>;

export interface StreamixRoute<
  TPath extends string = string,
  TName extends string | undefined = undefined,
  TParamsSchema extends ParamSchemaRecord | undefined = undefined,
  TSearchSchema extends SearchSchemaRecord | undefined = undefined,
> {
  readonly kind: 'route';
  readonly path: TPath;
  readonly name?: TName;
  readonly redirectTo?: string;
  readonly preload?: boolean;
  readonly component?: Type<unknown>;
  readonly viewTransition?: boolean;
  readonly paramsSchema?: TParamsSchema;
  readonly searchSchema?: TSearchSchema;
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

export interface StreamixLayout<TPath extends string = string, TEntries extends StreamixRoutes = StreamixRoutes> {
  readonly kind: 'layout';
  readonly path: TPath;
  readonly component?: Type<unknown>;
  readonly loadComponent?: Lazy<Type<unknown>>;
  readonly entries: TEntries;
  readonly providers?: StreamixRouteProviders;
}

export type StreamixRouteEntry = StreamixRoute | StreamixLayout;
export type StreamixRoutes = readonly StreamixRouteEntry[];

export type StreamixLeafRoute<TEntry> =
  TEntry extends StreamixRoute
    ? TEntry
    : TEntry extends StreamixLayout
      ? StreamixLeafRoute<TEntry['entries'][number]>
      : never;

export type StreamixLeafRoutes<TRoutes extends StreamixRoutes> =
  StreamixLeafRoute<TRoutes[number]>;
