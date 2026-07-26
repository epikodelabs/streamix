import type { Type } from '@angular/core';
import type {
  Lazy,
  StreamixLayout,
  StreamixRoute,
  StreamixRoutes,
} from './route-types';

export type RouteOptions = Omit<StreamixRoute, 'kind' | 'path' | 'component'>;
export type LayoutOptions = Omit<
  StreamixLayout,
  'kind' | 'path' | 'component' | 'loadComponent' | 'entries'
>;

export function route(
  path: string,
  component: Type<unknown>,
  options: RouteOptions = {},
): StreamixRoute {
  return { kind: 'route', path, component, ...options };
}

export function lazyRoute(
  path: string,
  loadComponent: Lazy<Type<unknown>>,
  options: RouteOptions = {},
): StreamixRoute {
  return { kind: 'route', path, loadComponent, ...options };
}

export function layout<const TRoutes extends StreamixRoutes>(
  path: string,
  component: Type<unknown>,
  entries: TRoutes,
  options: LayoutOptions = {},
): StreamixLayout & { readonly entries: TRoutes } {
  return { kind: 'layout', path, component, entries, ...options };
}

export function lazyLayout<const TRoutes extends StreamixRoutes>(
  path: string,
  loadComponent: Lazy<Type<unknown>>,
  entries: TRoutes,
  options: LayoutOptions = {},
): StreamixLayout & { readonly entries: TRoutes } {
  return { kind: 'layout', path, loadComponent, entries, ...options };
}
