import {
  EnvironmentInjector,
  NgZone,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import {
  TestBed,
} from '@angular/core/testing';

import {
  provideSxZoneScheduling,
} from '../lib/angular-zone';
import {
  animationFrameRenderScheduler,
  rendererScheduler,
} from '../lib/render-scheduler';

import { useAngularTestEnvironment } from './angular-test-environment';
import { idescribe } from '../../../src/tests/env.spec';
idescribe('sx Angular zone integration', () => {
  useAngularTestEnvironment();
  afterEach(() => {
    rendererScheduler.flushNow();
    rendererScheduler.setScheduler(animationFrameRenderScheduler);
  });

  it('does not resolve NgZone unless zone scheduling was explicitly enabled', () => {
    let ngZoneFactoryCalls = 0;
    const parent = TestBed.inject(EnvironmentInjector);
    const injector = createEnvironmentInjector(
      [
        {
          provide: NgZone,
          useFactory: () => {
            ngZoneFactoryCalls += 1;
            throw new Error('NgZone must not be resolved in the zoneless path.');
          },
        },
      ],
      parent,
    );

    try {
      runInInjectionContext(injector, () => {
        const binding = rendererScheduler.register(() => {});
        binding.markDirty();
        binding.destroy();
      });
      expect(ngZoneFactoryCalls).toBe(0);
    } finally {
      injector.destroy();
    }
  });

  it('installs outside-zone scheduling when a zoned project opts in', () => {
    let outsideCalls = 0;
    const zone = {
      runOutsideAngular<T>(callback: () => T): T {
        outsideCalls += 1;
        return callback();
      },
    } as NgZone;

    const parent = TestBed.inject(EnvironmentInjector);
    const injector = createEnvironmentInjector(
      [
        { provide: NgZone, useValue: zone },
        provideSxZoneScheduling(),
      ],
      parent,
    );

    try {
      const binding = rendererScheduler.register(() => {});
      binding.markDirty();

      expect(outsideCalls).toBeGreaterThan(0);

      binding.destroy();
    } finally {
      injector.destroy();
    }
  });

  it('keeps the surviving zone boundary while a concurrent app stays alive', () => {
    const callsA = { value: 0 };
    const callsB = { value: 0 };
    const zoneA = {
      runOutsideAngular<T>(callback: () => T): T {
        callsA.value += 1;
        return callback();
      },
    } as NgZone;
    const zoneB = {
      runOutsideAngular<T>(callback: () => T): T {
        callsB.value += 1;
        return callback();
      },
    } as NgZone;

    const parent = TestBed.inject(EnvironmentInjector);
    const injectorA = createEnvironmentInjector(
      [
        { provide: NgZone, useValue: zoneA },
        provideSxZoneScheduling(),
      ],
      parent,
    );
    const injectorB = createEnvironmentInjector(
      [
        { provide: NgZone, useValue: zoneB },
        provideSxZoneScheduling(),
      ],
      parent,
    );

    let destroyedA = false;
    let destroyedB = false;

    try {
      const flushOnce = (): void => {
        const binding = rendererScheduler.register(() => {});
        binding.markDirty();
        binding.destroy();
        rendererScheduler.flushNow();
      };

      // The last application to configure a zone owns the boundary.
      flushOnce();
      expect(callsA.value).toBe(0);
      expect(callsB.value).toBe(1);

      // Destroying the first application must not tear the boundary away
      // from the surviving application.
      injectorA.destroy();
      destroyedA = true;

      flushOnce();
      expect(callsA.value).toBe(0);
      expect(callsB.value).toBe(2);

      // Destroying the owning application restores default frame scheduling:
      // nothing routes through either zone any more.
      injectorB.destroy();
      destroyedB = true;

      flushOnce();
      expect(callsA.value).toBe(0);
      expect(callsB.value).toBe(2);
    } finally {
      if (!destroyedA) {
        injectorA.destroy();
      }
      if (!destroyedB) {
        injectorB.destroy();
      }
    }
  });
});
