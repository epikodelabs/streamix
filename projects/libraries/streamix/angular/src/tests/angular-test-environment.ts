import {
  getTestBed,
  TestBed,
} from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

/**
 * Initializes Angular's browser TestBed once for the current browser page.
 *
 * Testify bundles specs independently, so module-local flags are not sufficient:
 * every bundle can get its own copy of this helper while Angular's TestBed itself
 * remains page-global. Angular's singleton state is therefore the source of truth.
 */
export function ensureAngularTestEnvironment(): void {
  const testBed = getTestBed();

  if (testBed.platform && testBed.ngModule) {
    return;
  }

  // Recover defensively from a partially initialized environment. Angular normally
  // sets both values together, but keeping this branch makes the helper deterministic
  // even if another test bootstrap interrupted initialization.
  if (testBed.platform || testBed.ngModule) {
    testBed.resetTestEnvironment();
  }

  testBed.initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
    {
      teardown: {
        destroyAfterEach: true,
      },
    },
  );
}

/**
 * Registers Angular TestBed lifecycle hooks for one Jasmine/Testify suite.
 *
 * The platform is page-global and is initialized once in beforeAll. Individual
 * testing modules are reset after every spec without resetting the base platform.
 */
export function useAngularTestEnvironment(): void {
  beforeAll(() => {
    ensureAngularTestEnvironment();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });
}
