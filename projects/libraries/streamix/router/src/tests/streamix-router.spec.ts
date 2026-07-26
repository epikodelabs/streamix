import { Component, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  layout,
  lazyLayout,
  lazyRoute,
  route,
} from '../lib/route-branch-types';
import type { StreamixRoutes } from '../lib/route-types';
import {
  StreamixRouter,
  provideStreamixRouter,
} from '../lib/streamix-router';

@Component({
  standalone: true,
  selector: 'app-root',
  template: '<div data-router-outlet></div>',
})
class RootComponent {}

@Component({ standalone: true, template: '<h1>Home</h1>' })
class HomeComponent {}

@Component({
  standalone: true,
  template: '<h2>Parent</h2><div data-router-outlet></div>',
})
class ParentComponent {}

@Component({
  standalone: true,
  template: '<h2>Shell</h2><div data-router-outlet></div>',
})
class ShellComponent {}

@Component({ standalone: true, template: '<h3>Child</h3>' })
class ChildComponent {}

@Component({ standalone: true, template: '<h3>Settings</h3>' })
class SettingsComponent {}

describe('StreamixRouter: flat routes and layouts', () => {
  let injector: EnvironmentInjector;
  let rootFixture: HTMLElement;
  let router: StreamixRouter;

  async function bootstrap(routes: StreamixRoutes): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [RootComponent],
      providers: [provideStreamixRouter(routes)],
    }).compileComponents();

    const fixture = TestBed.createComponent(RootComponent);
    injector = fixture.debugElement.injector.get(EnvironmentInjector);
    rootFixture = fixture.debugElement.nativeElement;
    fixture.detectChanges();

    router = injector.get(StreamixRouter);
    const outlet = rootFixture.querySelector<HTMLElement>('[data-router-outlet]');

    if (!outlet) {
      throw new Error('Test root rendered no router outlet.');
    }

    router.connect(outlet);
  }

  function getOutletContent(): string {
    return rootFixture.querySelector<HTMLElement>('[data-router-outlet]')?.innerHTML ?? '';
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
  });

  it('renders a leaf route without a layout', async () => {
    const routes = [
      route('/', HomeComponent),
    ] as const satisfies StreamixRoutes;

    await bootstrap(routes);
    await navigate('/');

    expect(getOutletContent()).toContain('<h1>Home</h1>');
  });

  it('renders an eager layout around an eager leaf route', async () => {
    const routes = [
      layout(ParentComponent, [
        route('/child', ChildComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    await bootstrap(routes);
    await navigate('/child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('does not prefix leaf paths with layout names', async () => {
    const routes = [
      layout(ParentComponent, [
        route('/settings', SettingsComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    await bootstrap(routes);
    await navigate('/settings');

    expect(getOutletContent()).toContain('<h3>Settings</h3>');
    expect(router.state.path).toBe('/settings');
  });

  it('renders an eager layout around a lazy leaf route', async () => {
    const routes = [
      layout(ParentComponent, [
        lazyRoute('/lazy-child', async () => ChildComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    await bootstrap(routes);
    await navigate('/lazy-child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('renders a lazy layout around an eager leaf route', async () => {
    const routes = [
      lazyLayout(
        async () => ParentComponent,
        [route('/child', ChildComponent)],
      ),
    ] as const satisfies StreamixRoutes;

    await bootstrap(routes);
    await navigate('/child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('renders a lazy layout around a lazy leaf route', async () => {
    const routes = [
      lazyLayout(
        async () => ParentComponent,
        [lazyRoute('/lazy-child', async () => ChildComponent)],
      ),
    ] as const satisfies StreamixRoutes;

    await bootstrap(routes);
    await navigate('/lazy-child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('composes multiple layouts without creating a route hierarchy', async () => {
    const routes = [
      layout(ShellComponent, [
        layout(ParentComponent, [
          route('/child', ChildComponent),
        ]),
      ]),
    ] as const satisfies StreamixRoutes;

    await bootstrap(routes);
    await navigate('/child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Shell</h2>');
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('supports multiple absolute leaf routes inside one layout', async () => {
    const routes = [
      layout(ParentComponent, [
        route('/child', ChildComponent),
        route('/settings', SettingsComponent),
      ]),
    ] as const satisfies StreamixRoutes;

    await bootstrap(routes);

    await navigate('/child');
    expect(getOutletContent()).toContain('<h3>Child</h3>');

    await navigate('/settings');
    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Settings</h3>');
    expect(content).not.toContain('<h3>Child</h3>');
  });
});
