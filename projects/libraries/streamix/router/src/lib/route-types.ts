import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type { ParamSchema, SearchSchema } from './search-schema';
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

export interface StreamixRoute {
  readonly kind: 'route';
  readonly path: string;
  readonly name?: string;
  readonly redirectTo?: string;
  readonly preload?: boolean;
  readonly component?: Type<unknown>;
  readonly viewTransition?: boolean;
  readonly paramsSchema?: Readonly<Record<string, ParamSchema<unknown>>>;
  readonly searchSchema?: Readonly<Record<string, SearchSchema<unknown>>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly loadComponent?: Lazy<Type<unknown>>;
  readonly providers?: StreamixRouteProviders;
  readonly beforeEnter?: readonly BeforeEnter[];
  readonly beforeLeave?: readonly BeforeLeave[];
  readonly resolve?: RouteLoaders;
}

export interface StreamixLayout {
  readonly kind: 'layout';
  readonly component?: Type<unknown>;
  readonly loadComponent?: Lazy<Type<unknown>>;
  readonly entries: StreamixRoutes;
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
