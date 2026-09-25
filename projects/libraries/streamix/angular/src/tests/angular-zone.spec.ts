import {
  NgZone,
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

import {
  ensureAngularTestEnvironment,
} from './angular-test-environment';
import { idescribe } from '../../../src/tests/env.spec';

ensureAngularTestEnvironment();

idescribe('sx Angular zone integration', () => {
  afterEach(() => {
    rendererScheduler.flushNow();
    rendererScheduler.setScheduler(animationFrameRenderScheduler);
    TestBed.resetTestingModule();
  });

  it('does not resolve NgZone unless zone scheduling was explicitly enabled', () => {
    let ngZoneFactoryCalls = 0;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: NgZone,
          useFactory: () => {
            ngZoneFactoryCalls += 1;
            throw new Error('NgZone must not be resolved in the zoneless path.');
          },
        },
      ],
    });

    TestBed.runInInjectionContext(() => {
      expect(() => ɵinstallSxAngularZone()).not.toThrow();
    });

    expect(ngZoneFactoryCalls).toBe(0);
  });

  it('installs outside-zone scheduling when a zoned project opts in', () => {
    let outsideCalls = 0;
    const zone = {
      runOutsideAngular<T>(callback: () => T): T {
        outsideCalls += 1;
        return callback();
      },
    };

    TestBed.configureTestingModule({
      providers: [
        provideSxZoneScheduling(),
        { provide: NgZone, useValue: zone },
      ],
    });

    TestBed.runInInjectionContext(() => {
      ɵinstallSxAngularZone();
    });

    const binding = rendererScheduler.register(() => {});
    binding.markDirty();

    expect(outsideCalls).toBeGreaterThan(0);

    binding.destroy();
  });
});
