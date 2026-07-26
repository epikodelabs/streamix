import type { EnvironmentProviders, Provider, Type } from '@angular/core';
import type { ParamSchema, SearchSchema } from './search-schema';
import type { DeactivationContext, NavigationContext } from './vanilla-router';

export type MaybePromise<T> = T | PromiseLike<T>;
export type Lazy<T> = () => MaybePromise<T | { readonly default: T }>;



export type StreamixRouteProvider =
  | Provider
  | EnvironmentProviders;

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
export type StreamixRouteProviders =
  readonly StreamixRouteProvider[];

export interface StreamixRouteModule {
  readonly component?: Type<unknown>;
  readonly routes?: StreamixRoutes;
  readonly beforeEnter?: readonly BeforeEnter[];
  readonly beforeLeave?: readonly BeforeLeave[];
  readonly resolve?: RouteLoaders;
  readonly providers?: StreamixRouteProviders;
}

export interface StreamixRoute {
  readonly path: string;
  readonly name?: string;
  readonly redirectTo?: string;
  readonly preload?: boolean;
  readonly component?: Type<unknown>;
  readonly children?: StreamixRoutes;
  readonly viewTransition?: boolean;
  readonly paramsSchema?: Readonly<Record<string, ParamSchema<unknown>>>;
  readonly searchSchema?: Readonly<Record<string, SearchSchema<unknown>>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly loadComponent?: Lazy<Type<unknown>>;
  readonly loadChildren?: Lazy<StreamixRoutes>;
  readonly providers?: StreamixRouteProviders;
  readonly beforeEnter?: readonly BeforeEnter[];
  readonly beforeLeave?: readonly BeforeLeave[];
  readonly resolve?: RouteLoaders;
}

export type StreamixRoutes = readonly StreamixRoute[];
