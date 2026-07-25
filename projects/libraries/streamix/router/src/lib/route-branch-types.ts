import type { Type } from '@angular/core';
import type { StreamixRouteModule, StreamixRoutes } from './route-types';

export interface RouteBranch<
  TRoutes extends StreamixRoutes = StreamixRoutes,
> extends StreamixRouteModule {
  readonly component: Type<unknown>;
  readonly routes: TRoutes;
}

export function branch<const TRoutes extends StreamixRoutes>(
  component: Type<unknown>,
  routes: TRoutes,
): RouteBranch<TRoutes> {
  return { component, routes };
}
