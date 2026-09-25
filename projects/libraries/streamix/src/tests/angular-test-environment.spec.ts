import {
  TestBed,
} from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

let initialized = false;

/**
 * Initializes Angular's browser TestBed for Testify/Jasmine.
 *
 * Testify provides the browser/Jasmine runner, but it does not initialize
 * Angular's testing platform. Angular component tests must do that once.
 */
export function ensureAngularTestEnvironment(): void {
  if (initialized) {
    return;
  }

  TestBed.initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
    {
      teardown: {
        destroyAfterEach: true,
      },
    },
  );

  initialized = true;
}
