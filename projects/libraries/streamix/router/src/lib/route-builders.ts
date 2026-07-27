import type { Type } from '@angular/core';

import type { ParamSchemaRecord, QuerySchemaRecord } from './query-schema';
import type {
  Lazy, StreamixLayout, StreamixLayoutOptions, StreamixRoute, StreamixRouteOptions, StreamixRoutes
} from './route-types';

export function route<
  const TPath extends string,
  const TName extends
    string | undefined = undefined,
  const TParamsSchema extends
    ParamSchemaRecord | undefined = undefined,
  const TQuerySchema extends
    QuerySchemaRecord | undefined = undefined,
>(
  path: TPath,
  component: Type<unknown>,
  options: StreamixRouteOptions<
    TName,
    TParamsSchema,
    TQuerySchema
  > = {},
): StreamixRoute<
  TPath,
  TName,
  TParamsSchema,
  TQuerySchema
> {
  return {
    kind: 'route',
    path,
    component,
    ...options,
  };
}

export function lazyRoute<
  const TPath extends string,
  const TName extends
    string | undefined = undefined,
  const TParamsSchema extends
    ParamSchemaRecord | undefined = undefined,
  const TQuerySchema extends
    QuerySchemaRecord | undefined = undefined,
>(
  path: TPath,
  loadComponent: Lazy<Type<unknown>>,
  options: StreamixRouteOptions<
    TName,
    TParamsSchema,
    TQuerySchema
  > = {},
): StreamixRoute<
  TPath,
  TName,
  TParamsSchema,
  TQuerySchema
> {
  return {
    kind: 'route',
    path,
    loadComponent,
    ...options,
  };
}

export function redirectRoute<
  const TPath extends string,
  const TRedirectTo extends string,
  const TName extends
    string | undefined = undefined,
>(
  path: TPath,
  redirectTo: TRedirectTo,
  options: Omit<
    StreamixRouteOptions<TName, undefined, undefined>,
    'redirectTo' | 'paramsSchema' | 'querySchema' | 'outlet'
  > = {},
): StreamixRoute<
  TPath,
  TName
> {
  return {
    kind: 'route',
    path,
    redirectTo,
    ...options,
  };
}

export function layout<
  const TPath extends string,
  const TEntries extends StreamixRoutes,
>(
  path: TPath,
  component: Type<unknown>,
  entries: TEntries,
  options: StreamixLayoutOptions = {},
): StreamixLayout<
  TPath,
  TEntries
> {
  return {
    kind: 'layout',
    path,
    component,
    entries,
    ...options,
  };
}

export function lazyLayout<
  const TPath extends string,
  const TEntries extends StreamixRoutes,
>(
  path: TPath,
  loadComponent: Lazy<Type<unknown>>,
  entries: TEntries,
  options: StreamixLayoutOptions = {},
): StreamixLayout<
  TPath,
  TEntries
> {
  return {
    kind: 'layout',
    path,
    loadComponent,
    entries,
    ...options,
  };
}
