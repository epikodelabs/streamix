import { type EnvironmentInjector, type Type, reflectComponentType } from '@angular/core';

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

export interface RouteInputBinding {
  readonly propName: string;
  readonly templateName: string;
}

function getRouteInputBindings(
  component: Type<unknown>,
): readonly RouteInputBinding[] {
  return reflectComponentType(component)?.inputs ?? [];
}

export function bindRouteInputs(
  ref: InputBindingTarget,
  componentOrInputs: Type<unknown> | readonly RouteInputBinding[],
  route: ActivatedRoute,
): void {
  const inputs: readonly RouteInputBinding[] = isRouteInputBindings(componentOrInputs)
    ? componentOrInputs
    : getRouteInputBindings(componentOrInputs);
  const values = collectRouteInputValues(route);

  for (const input of inputs) {
    if (Object.prototype.hasOwnProperty.call(values, input.templateName)) {
      ref.setInput(input.templateName, values[input.templateName]);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, input.propName)) {
      ref.setInput(input.templateName, values[input.propName]);
    }
  }
}

export function collectRouteInputValues(
  route: ActivatedRoute,
): Record<string, unknown> {
  const { __params, __search, ...resolved } = route.data ?? {};

  return {
    ...route.params,
    ...route.queryParams,
    ...(isRecord(__search) ? __search : {}),
    ...(isRecord(__params) ? __params : {}),
    ...resolved,
  };
}

function isRouteInputBindings(
  value: Type<unknown> | readonly RouteInputBinding[],
): value is readonly RouteInputBinding[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function adaptRouteComponent(
  component: Type<unknown>,
  context: RouteAdapterContext,
  routeProviders?: StreamixRouteProviders,
): RouteComponent {
  return context.render(component, context.injector, routeProviders);
}
