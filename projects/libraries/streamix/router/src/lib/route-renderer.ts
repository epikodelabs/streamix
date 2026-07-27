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
  findOutlet,
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


function createScopedInjector(
  providers:
    StreamixRouteProviders | undefined,
  parent: EnvironmentInjector,
  label: string,
): EnvironmentInjector | undefined {
  if (!providers?.length) {
    return undefined;
  }

  try {
    return createEnvironmentInjector(
      Array.from(providers),
      parent,
      label,
    );
  } catch (error) {
    throw new Error(
      `Failed to create route injector for "${label}": ` +
      (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
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
  let containingOutlet: HTMLElement | null = null;

  try {
    try {
      bindRouteInputs(
        ref,
        component,
        route,
      );
    } catch (error) {
      throw new Error(
        `Failed to bind route inputs for "${component.name || 'anonymous component'}": ` +
        (error instanceof Error ? error.message : String(error)),
        { cause: error },
      );
    }

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

      containingOutlet ??=
        (host as Node & {
          __streamixOutlet?: HTMLElement;
        }).__streamixOutlet ?? null;

      const outlet =
        containingOutlet ??
        host.closest<HTMLElement>(
          `[${OUTLET_ATTRIBUTE}]`,
        );

      if (outlet) {
        dispatchOutletLifecycleEvent(
          outlet,
          OUTLET_DEACTIVATE_EVENT,
          ref.instance,
        );
      }

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
  const errors: unknown[] = [];

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
    } catch (error) {
      errors.push(error);
    }

    try {
      layer.injector
        ?.destroy();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Multiple errors occurred while disposing a route view.',
    );
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
          // The route outlet selects the application-level render target.
          // Layout layers always compose through their primary child outlet.
          const outletName = '';
          const outlet = findOutlet(parent.rendered.node, outletName);

          if (!outlet) {
            throw new Error(
              `Cannot render "${view.label}": ` +
              `the parent layout has no router outlet` +
              (outletName ? ` named "${outletName}"` : ` (primary)`),
            );
          }

          outlet.replaceChildren(
            rendered.node,
          );

          // Capture the outlet while the node is attached. Parent-layer
          // disposal may detach this host before its own dispose() runs.
          const renderedNode =
            rendered.node as Node & {
              __streamixOutlet?: HTMLElement;
            };
          renderedNode.__streamixOutlet = outlet;

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
