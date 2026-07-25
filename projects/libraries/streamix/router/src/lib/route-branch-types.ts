import { Type } from '@angular/core';
import { Lazy, StreamixRoutes } from './streamix-router';

/**
 * A source for a component, which can be either a direct reference to the component's class
 * or a lazy-loading function that returns a promise of the component's class.
 */
export type ComponentSource =
  | Type<unknown>
  | Lazy<Type<unknown>>;

/**
 * Represents a branch in the route tree, which includes an optional layout component
 * and an array of nested routes. This is the fundamental unit for both eager and lazy UI structures.
 */
export interface RouteBranch<
  TRoutes extends StreamixRoutes = StreamixRoutes,
> {
  readonly component?: ComponentSource;
  readonly routes?: TRoutes;
}

/**
 * Defines the UI for a route. It can be a direct component source or a `RouteBranch`
 * that includes a component and its nested routes.
 */
export type RouteView<
  TRoutes extends StreamixRoutes = StreamixRoutes,
> =
  | ComponentSource
  | RouteBranch<TRoutes>;

/**
 * A helper function to create a `RouteBranch` in a concise way.
 *
 * @param component The component source (eager or lazy).
 * @param routes The nested routes for this branch.
 * @returns A `RouteBranch` object.
 */
export function branch<
  const TRoutes extends StreamixRoutes,
>(component: ComponentSource, routes: TRoutes): RouteBranch<TRoutes> {
  return { component, routes };
}