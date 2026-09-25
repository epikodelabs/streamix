import {
  NgZone,
  inject,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';

import {
  createOutsideAngularRenderScheduler,
  rendererScheduler,
} from './render-scheduler';

const configuredZones = new WeakSet<object>();

/**
 * Enables outside-NgZone scheduling for a Zone.js-backed Angular application.
 *
 * Streamix never probes for NgZone from directives or compiled views. Installing
 * this provider is the explicit declaration that the application wants zone
 * scheduling. The environment initializer is the only place NgZone is resolved.
 */
export function provideSxZoneScheduling(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const zone = inject(NgZone);
    ɵconfigureSxAngularZone(zone);
  });
}

/**
 * Installs the shared sx frame scheduler outside one Angular NgZone.
 * Repeated calls for the same application zone are free.
 * @internal
 */
export function ɵconfigureSxAngularZone(zone: NgZone): void {
  if (configuredZones.has(zone)) {
    return;
  }

  configuredZones.add(zone);
  rendererScheduler.setScheduler(
    createOutsideAngularRenderScheduler(zone),
  );
}

/**
 * Legacy internal hook retained so previously generated/runtime code remains
 * source-compatible. Zone installation is now provider-driven and this hook is
 * intentionally inert: zoneless applications never resolve NgZone implicitly.
 * @internal
 */
export function ɵinstallSxAngularZone(): void {}
