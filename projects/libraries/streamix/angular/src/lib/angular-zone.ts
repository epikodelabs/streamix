import {
  InjectionToken,
  NgZone,
  inject,
  type Provider,
} from '@angular/core';

import {
  createOutsideAngularRenderScheduler,
  rendererScheduler,
} from './render-scheduler';

const configuredZones = new WeakSet<object>();

/**
 * Explicit application-level opt-in for Zone.js-backed Angular applications.
 *
 * Zoneless Angular is the default in modern Angular and must not resolve or use
 * NgZone merely because Zone.js happens to exist on the page. A zoned project
 * enables this provider next to its zone-backed Angular configuration.
 */
export const SX_ZONE_SCHEDULING = new InjectionToken<boolean>(
  'SX_ZONE_SCHEDULING',
  {
    providedIn: 'root',
    factory: () => false,
  },
);

/**
 * Enables outside-NgZone scheduling for a Zone.js-backed Angular application.
 * Do not install this provider in zoneless applications.
 */
export function provideSxZoneScheduling(): Provider {
  return {
    provide: SX_ZONE_SCHEDULING,
    useValue: true,
  };
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
 * Injection-context convenience used by directives and compiler-installed
 * views.
 *
 * This deliberately does not try to infer zone configuration from
 * `NgZone.isInAngularZone()` or the presence of global Zone.js. Zoneless apps
 * can legitimately load Zone.js for another library/application. NgZone is
 * resolved only when the application explicitly opted into sx zone scheduling.
 * @internal
 */
export function ɵinstallSxAngularZone(): void {
  const enabled = inject(SX_ZONE_SCHEDULING);
  if (!enabled) {
    return;
  }

  const zone = inject(NgZone, { optional: true });
  if (zone) {
    ɵconfigureSxAngularZone(zone);
  }
}
