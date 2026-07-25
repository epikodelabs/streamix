import { type EnvironmentInjector, type Type, reflectComponentType } from '@angular/core';

import { unwrapDefault } from './adapter-utils';
import type { ComponentSource } from './route-branch-types';
import type { ActivatedRoute, RouteComponent } from './vanilla-router';

export type MaybePromise<T> = T | PromiseLike<T>;

export interface InputBindingTarget {
  setInput(name: string, value: unknown): void;
}

export interface AdaptComponentRoute<TProviders = unknown> {
  readonly path: string;
  readonly providers?: readonly TProviders[];
}

export type RouteComponentRenderer<TProviders = unknown> = (
  component: Type<unknown>,
  injector: EnvironmentInjector,
  routeProviders?: readonly TProviders[],
) => RouteComponent;

export interface RouteAdapterContext<TProviders = unknown> {
  readonly injector: EnvironmentInjector;
  readonly render: RouteComponentRenderer<TProviders>;
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

function isAngularComponent(value: ComponentSource): value is Type<unknown> {
  return reflectComponentType(value as Type<unknown>) !== null;
}

function isRouteInputBindingList(
  value: Type<unknown> | readonly RouteInputBinding[],
): value is readonly RouteInputBinding[] {
  return Array.isArray(value);
}

export function bindRouteInputs(
  ref: InputBindingTarget,
  componentOrInputs: Type<unknown> | readonly RouteInputBinding[],
  route: ActivatedRoute,
): void {
  const inputs = isRouteInputBindingList(componentOrInputs)
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
  const routeData = route.data ?? {};
  const schemaParams = routeData['__params'];
  const schemaSearch = routeData['__search'];
  const resolved = Object.fromEntries(
    Object.entries(routeData).filter(
      ([key]) => key !== '__params' && key !== '__search',
    ),
  );

  return {
    ...route.params,
    ...route.queryParams,
    ...(isRecord(schemaSearch) ? schemaSearch : {}),
    ...(isRecord(schemaParams) ? schemaParams : {}),
    ...resolved,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function adaptRouteComponent<TProviders>(
  componentSource: ComponentSource,
  context: RouteAdapterContext<TProviders>,
  routeProviders?: readonly TProviders[],
): RouteComponent {
  if (isAngularComponent(componentSource)) {
    return context.render(componentSource, context.injector, routeProviders);
  }

  const loadComponent = componentSource;
  let loaded: Promise<Type<unknown>> | undefined;

  return async () => {
    loaded ??= Promise.resolve(loadComponent())
      .then(unwrapDefault)
      .catch((error) => {
        loaded = undefined;
        throw error;
      });

    return context.render(await loaded, context.injector, routeProviders);
  };
}
