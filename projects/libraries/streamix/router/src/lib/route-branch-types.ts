import type { Type } from '@angular/core';
import type { StreamixRoutes } from './route-types';

export interface RouteBranch<
  TRoutes extends StreamixRoutes = StreamixRoutes,
> {
  readonly component?: Type<unknown>;
  readonly routes?: TRoutes;
}

export function branch<const TRoutes extends StreamixRoutes>(
  component: Type<unknown>,
  routes: TRoutes,
): RouteBranch<TRoutes> {
  return { component, routes };
}
