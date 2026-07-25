import {
  reflectComponentType,
  type EnvironmentInjector,
  type Type,
} from '@angular/core';

import type { StreamixRouteProviders } from './route-types';
import type { ActivatedRoute, RouteComponent } from './vanilla-router';

export interface InputBindingTarget {
  setInput(name: string, value: unknown): void;
}

export type RouteComponentRenderer = (
  component: Type<unknown>,
  injector: EnvironmentInjector,
  routeProviders?: StreamixRouteProviders,
) => RouteComponent;

export interface RouteAdapterContext {
  readonly injector: EnvironmentInjector;
  readonly render: RouteComponentRenderer;
}

export function adaptRouteComponent(
  component: Type<unknown>,
  context: RouteAdapterContext,
  routeProviders?: StreamixRouteProviders,
): RouteComponent {
  return context.render(component, context.injector, routeProviders);
}

export function collectRouteInputValues(route: ActivatedRoute): Record<string, unknown> {
  const { __params, __search, ...resolved } = route.data ?? {};

  return {
    ...route.params,
    ...route.queryParams,
    ...(__params && typeof __params === 'object' ? __params : {}),
    ...(__search && typeof __search === 'object' ? __search : {}),
    ...resolved,
  };
}

export function bindRouteInputs(
  target: InputBindingTarget,
  component: Type<unknown>,
  route: ActivatedRoute,
): void {
  const inputs = reflectComponentType(component)?.inputs ?? [];
  const values = collectRouteInputValues(route);

  for (const input of inputs) {
    const value =
      values[input.templateName] ??
      values[input.propName];

    if (value !== undefined) {
      target.setInput(input.templateName, value);
    }
  }
}
