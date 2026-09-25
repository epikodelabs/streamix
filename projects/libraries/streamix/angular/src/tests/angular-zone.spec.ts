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
  ɵinstallSxAngularZone,
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
        expect(() => ɵinstallSxAngularZone()).not.toThrow();
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
});
