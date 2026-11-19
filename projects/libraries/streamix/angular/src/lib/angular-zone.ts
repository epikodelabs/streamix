import {
  NgZone,
  DestroyRef,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';

import {
  createOutsideAngularRenderScheduler,
  rendererScheduler,
  type RenderScheduler,
} from './render-scheduler';

const configuredSchedulers = new WeakMap<object, RenderScheduler>();

/**
 * Enables outside-NgZone scheduling for a Zone.js-backed Angular application.
 *
 * Streamix never probes for NgZone from directives or compiled views. Installing
 * this provider is the explicit declaration that the application wants zone
 * scheduling. The environment initializer is the only place NgZone is resolved.
 *
 * The installed boundary is released again when the application injector is
 * destroyed, so sequentially bootstrapped applications do not leave updates
 * routed through a zone that no longer exists.
 */
export function provideSxZoneScheduling(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const zone = inject(NgZone);
    const destroyRef = inject(DestroyRef);

    ɵconfigureSxAngularZone(zone);

    destroyRef.onDestroy(() => {
      ɵreleaseSxAngularZone(zone);
    });
  });
}

/**
 * Installs the shared sx frame scheduler outside one Angular NgZone.
 * Repeated calls for the same application zone are free.
 * @internal
 */
export function ɵconfigureSxAngularZone(zone: NgZone): void {
  if (configuredSchedulers.has(zone)) {
    return;
  }

  const scheduler = createOutsideAngularRenderScheduler(zone);
  configuredSchedulers.set(zone, scheduler);
  rendererScheduler.setScheduler(scheduler);
}

/**
 * Releases the scheduler installed for one zone. The global boundary is only
 * restored when this zone is still its owner: a concurrently bootstrapped
 * application that installed its own boundary keeps it.
 * @internal
 */
export function ɵreleaseSxAngularZone(zone: NgZone): void {
  const scheduler = configuredSchedulers.get(zone);

  if (scheduler === undefined) {
    return;
  }

  configuredSchedulers.delete(zone);
  rendererScheduler.restoreScheduler(scheduler);
}
