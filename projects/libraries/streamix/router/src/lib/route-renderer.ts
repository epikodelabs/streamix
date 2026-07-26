import {
  ApplicationRef,
  EnvironmentInjector,
  Injector,
  Type,
  createComponent,
  createEnvironmentInjector,
} from '@angular/core';

import {
  bindRouteInputs,
} from './route-adapter';

import type {
  StreamixRouteProviders,
} from './route-types';

import {
  OUTLET_ACTIVATE_EVENT,
  OUTLET_ATTRIBUTE,
  OUTLET_DEACTIVATE_EVENT,
  dispatchOutletLifecycleEvent,
} from './router-events';

import type {
  ActivatedRoute,
  RenderedRouteNode,
  RouteComponent,
  RouteRenderContext,
} from './vanilla-router';

export interface RouteRenderTokens {
  readonly routeToken: unknown;
  readonly contextToken: unknown;
}

export interface ResolvedRouteView {
  readonly component:
    Type<unknown>;
  readonly providers?:
    StreamixRouteProviders;
  readonly label: string;
}

interface RenderedLayer {
  readonly rendered:
    RenderedRouteNode;
  readonly injector?:
    EnvironmentInjector;
}

function findNestedOutlet(
  node: Node,
): HTMLElement | null {
  if (
    !(
      node instanceof Element ||
      node instanceof DocumentFragment
    )
  ) {
    return null;
  }

  if (
    node instanceof HTMLElement &&
    node.hasAttribute(
      OUTLET_ATTRIBUTE,
    )
  ) {
    return node;
  }

  const outlets =
    node.querySelectorAll<HTMLElement>(
      `[${OUTLET_ATTRIBUTE}]`,
    );

  if (outlets.length > 1) {
    throw new Error(
      'A layout must render exactly one router outlet.',
    );
  }

  return outlets[0] ?? null;
}

function createScopedInjector(
  providers:
    StreamixRouteProviders | undefined,
  parent: EnvironmentInjector,
  label: string,
): EnvironmentInjector | undefined {
  if (!providers?.length) {
    return undefined;
  }

  return createEnvironmentInjector(
    Array.from(providers),
    parent,
    label,
  );
}

function createAngularComponent(
  appRef: ApplicationRef,
  tokens: RouteRenderTokens,
  component: Type<unknown>,
  environmentInjector:
    EnvironmentInjector,
  route: ActivatedRoute,
  context: RouteRenderContext,
): RenderedRouteNode {
  const host =
    document.createElement(
      'streamix-view',
    );

  const elementInjector =
    Injector.create({
      parent:
        environmentInjector,
      providers: [
        {
          provide:
            tokens.routeToken,
          useValue: route,
        },
        {
          provide:
            tokens.contextToken,
          useValue: context,
        },
      ],
    });

  const ref =
    createComponent(
      component,
      {
        hostElement: host,
        elementInjector,
        environmentInjector,
      },
    );

  let attached = false;
  let disposed = false;

  try {
    bindRouteInputs(
      ref,
      component,
      route,
    );

    appRef.attachView(
      ref.hostView,
    );

    attached = true;

    ref.changeDetectorRef
      .detectChanges();
  } catch (error) {
    if (attached) {
      try {
        appRef.detachView(
          ref.hostView,
        );
      } catch {}
    }

    ref.destroy();
    throw error;
  }

  return {
    node: host,
    component: ref.instance,

    dispose(): void {
      if (disposed) {
        return;
      }

      disposed = true;

      host.parentElement
        ?.closest<HTMLElement>(
          `[${OUTLET_ATTRIBUTE}]`,
        )
        ?.dispatchEvent(
          new CustomEvent(
            OUTLET_DEACTIVATE_EVENT,
            {
              detail:
                ref.instance,
            },
          ),
        );

      try {
        if (attached) {
          appRef.detachView(
            ref.hostView,
          );

          attached = false;
        }
      } finally {
        ref.destroy();
        host.remove();
      }
    },
  };
}

function disposeLayers(
  layers:
    readonly RenderedLayer[],
): void {
  for (
    let index =
      layers.length - 1;
    index >= 0;
    index--
  ) {
    const layer =
      layers[index];

    try {
      layer.rendered
        .dispose?.();
    } finally {
      layer.injector
        ?.destroy();
    }
  }
}

export function composeAngularRouteView(
  appRef: ApplicationRef,
  rootInjector:
    EnvironmentInjector,
  tokens: RouteRenderTokens,
  views:
    readonly ResolvedRouteView[],
): RouteComponent {
  return async (
    route,
    context,
  ) => {
    const layers:
      RenderedLayer[] = [];

    let parentInjector =
      rootInjector;

    try {
      for (
        let index = 0;
        index < views.length;
        index++
      ) {
        const view =
          views[index];

        const scopedInjector =
          createScopedInjector(
            view.providers,
            parentInjector,
            view.label,
          );

        const activeInjector =
          scopedInjector ??
          parentInjector;

        const rendered =
          createAngularComponent(
            appRef,
            tokens,
            view.component,
            activeInjector,
            route,
            context,
          );

        const parent =
          layers[
            layers.length - 1
          ];

        if (parent) {
          const outlet =
            findNestedOutlet(
              parent.rendered.node,
            );

          if (!outlet) {
            throw new Error(
              `Cannot render ` +
              `"${view.label}": ` +
              'the parent layout ' +
              'has no router outlet.',
            );
          }

          outlet.replaceChildren(
            rendered.node,
          );

          if (
            rendered.component !==
            undefined
          ) {
            dispatchOutletLifecycleEvent(
              outlet,
              OUTLET_ACTIVATE_EVENT,
              rendered.component,
            );
          }
        }

        layers.push({
          rendered,
          injector:
            scopedInjector,
        });

        parentInjector =
          activeInjector;
      }

      const first =
        layers[0];

      const last =
        layers[
          layers.length - 1
        ];

      if (!first || !last) {
        throw new Error(
          'A route view requires at least one component.',
        );
      }

      return {
        node:
          first.rendered.node,
        component:
          last.rendered.component,

        dispose(): void {
          disposeLayers(layers);
        },
      };
    } catch (error) {
      disposeLayers(layers);
      throw error;
    }
  };
}
