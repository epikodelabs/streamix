import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import {
  layout,
  lazyLayout,
  lazyRoute,
  route,
} from '../lib/route-builders';
import type { StreamixRoutes } from '../lib/route-types';
import {
  StreamixRouter,
  provideStreamixRouter,
} from '../lib/streamix-router';

@Component({ standalone: true, template: '<h1>Home</h1>' })
class HomeComponent {}

@Component({
  standalone: true,
  template: '<h2>Parent</h2><div data-router-outlet></div>',
  host: { 'parent-cmp': '' },
})
class ParentComponent {}

@Component({
  standalone: true,
  template: '<h2>Shell</h2><div data-router-outlet></div>',
  host: { 'shell-cmp': '' },
})
class ShellComponent {}

@Component({
  standalone: true, template: '<h3>Child</h3>',
  host: { 'child-cmp': '' }
})
class ChildComponent {}

@Component({
  standalone: true,
  template: '<h3>Settings</h3>',
  host: { 'settings-cmp': '' },
})
class SettingsComponent {}

describe('StreamixRouter: flat routes and layouts', () => {
  let outlet: HTMLElement;
  let router: StreamixRouter;

  function bootstrap(routes: StreamixRoutes): void {
    TestBed.configureTestingModule({
      providers: [...provideStreamixRouter(routes)],
    });

    outlet = document.createElement('div');
    router = TestBed.inject(StreamixRouter);
    router.connect('', outlet);
  }

  // Initialize Angular test environment once for the entire suite
  beforeAll(() => {
    TestBed.initTestEnvironment(
      BrowserTestingModule,
      platformBrowserTesting(),
    );
  });

  function getOutletContent(): string {
    return outlet.innerHTML;
  }

  async function navigate(path: string): Promise<void> {
    await router.navigate({ path });
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    spyOn(window.history, 'pushState').and.callThrough();
    spyOn(window.history, 'replaceState').and.callThrough();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    router?.dispose();
    outlet?.remove();
  });

  it('renders a leaf route without a layout', async () => {
    const routes = [
      route('/', HomeComponent),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);
    await navigate('/');

    expect(getOutletContent()).toContain('<h1>Home</h1>');
  });

  it('supports a layout index route', async () => {
    const routes = [
      layout('/admin', ParentComponent, [
        route('', HomeComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);
    await navigate('/admin');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h1>Home</h1>');
  });

  it('renders an eager layout around an eager leaf route', async () => {
    const routes = [
      layout('/admin', ParentComponent, [
        route('/child', ChildComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);
    await navigate('/admin/child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('inherits the layout path prefix' , async () => {
    const routes = [
      layout('/admin', ParentComponent, [
        route('/settings', SettingsComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);
    await navigate('/admin/settings');

    expect(getOutletContent()).toContain('<h3>Settings</h3>');
    expect(router.state.path).toBe('/admin/settings');
  });

  it('renders an eager layout around a lazy leaf route', async () => {
    const routes = [
      layout('/admin', ParentComponent, [
        lazyRoute('/lazy-child', async () => ChildComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);
    await navigate('/admin/lazy-child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('renders a lazy layout around an eager leaf route', async () => {
    const routes = [
      lazyLayout(
        '/admin',
        async () => ParentComponent,
        [route('/child', ChildComponent)],
      ),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);
    await navigate('/admin/child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('renders a lazy layout around a lazy leaf route', async () => {
    const routes = [
      lazyLayout(
        '/admin',
        async () => ParentComponent,
        [lazyRoute('/lazy-child', async () => ChildComponent)],
      ),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);
    await navigate('/admin/lazy-child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('composes multiple layouts without creating a route hierarchy', async () => {
    const routes = [
      layout('/app', ShellComponent, [
        layout('/admin', ParentComponent, [
          route('/child', ChildComponent),
        ]),
      ]),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);
    await navigate('/app/admin/child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Shell</h2>');
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('supports multiple leaf routes inside one prefixed layout', async () => {
    const routes = [
      layout('/admin', ParentComponent, [
        route('/child', ChildComponent),
        route('/settings', SettingsComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    bootstrap(routes);

    await navigate('/admin/child');
    expect(getOutletContent()).toContain('<h3>Child</h3>');

    await navigate('/admin/settings');
    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Settings</h3>');
    expect(content).not.toContain('<h3>Child</h3>');
  });

  it('supports named outlets', async () => {
    const routes = [
      route('/', SettingsComponent, { outlet: 'sidebar' }),
      route('/', HomeComponent),
    ] as const satisfies StreamixRoutes;

    const sidebarOutlet = document.createElement('div');
    sidebarOutlet.id = 'sidebar-outlet';

    bootstrap(routes);
    router.connect('sidebar', sidebarOutlet);

    await navigate('/');
    expect(getOutletContent()).toContain('<h1>Home</h1>');
    // After navigating to '/', both the primary and sidebar outlets should render.
    expect(sidebarOutlet.innerHTML).toContain('<h3>Settings</h3>');

    router.disconnect('sidebar', sidebarOutlet);
  });
});
