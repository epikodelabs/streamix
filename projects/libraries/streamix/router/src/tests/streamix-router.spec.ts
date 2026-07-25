import { Component, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideStreamixRouter,
  StreamixOutlet,
  StreamixRouter,
  type StreamixRoutes,
} from '@epikodelabs/streamix/router';

@Component({
  standalone: true,
  selector: 'app-root',
  template: `<streamix-outlet />`,
  imports: [StreamixOutlet],
})
class RootComponent {}

@Component({ standalone: true, template: '<h1>Home</h1>' })
class HomeComponent {}

@Component({
  standalone: true,
  template: '<h2>Parent</h2><streamix-outlet />',
  imports: [StreamixOutlet],
})
class ParentComponent {}

@Component({ standalone: true, template: '<h3>Child</h3>' })
class ChildComponent {}

describe('StreamixRouter: Nested Routing', () => {
  let injector: EnvironmentInjector;
  let rootFixture: HTMLElement;

  async function bootstrap(routes: StreamixRoutes): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [RootComponent],
      providers: [provideStreamixRouter(routes)],
    }).compileComponents();

    const fixture = TestBed.createComponent(RootComponent);
    injector = fixture.debugElement.injector.get(EnvironmentInjector);
    rootFixture = fixture.debugElement.nativeElement;
    fixture.detectChanges();
  }

  function getOutletContent(): string {
    return rootFixture.querySelector('streamix-outlet')?.innerHTML ?? '';
  }

  async function navigate(path: string): Promise<void> {
    const router = injector.get(StreamixRouter);
    await router.navigate({ path });
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    spyOn(window.history, 'pushState');
    spyOn(window.history, 'replaceState');
  });

  it('should handle eager parent + eager child', async () => {
    const routes: StreamixRoutes = [
      { path: '', load: () => ({ component: HomeComponent }) },
      {
        path: 'parent',
        load: () => ({
          component: ParentComponent,
          routes: [
            { path: 'child', load: () => ({ component: ChildComponent }) },
          ],
        }),
      },
    ];

    await bootstrap(routes);
    await navigate('/parent/child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('should handle eager parent + async child module', async () => {
    const routes: StreamixRoutes = [
      {
        path: 'parent',
        load: () => ({
          component: ParentComponent,
          routes: [
            {
              path: 'lazy-child',
              load: async () => ({ component: ChildComponent }),
            },
          ],
        }),
      },
    ];

    await bootstrap(routes);
    await navigate('/parent/lazy-child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('should handle async parent module + eager child', async () => {
    const routes: StreamixRoutes = [
      {
        path: 'lazy-parent',
        load: async () => ({
          component: ParentComponent,
          routes: [
            { path: 'child', load: () => ({ component: ChildComponent }) },
          ],
        }),
      },
    ];

    await bootstrap(routes);
    await navigate('/lazy-parent/child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('should handle async parent + async child modules', async () => {
    const routes: StreamixRoutes = [
      {
        path: 'lazy-parent',
        load: async () => ({
          component: ParentComponent,
          routes: [
            {
              path: 'lazy-child',
              load: async () => ({ component: ChildComponent }),
            },
          ],
        }),
      },
    ];

    await bootstrap(routes);
    await navigate('/lazy-parent/lazy-child');

    const content = getOutletContent();
    expect(content).toContain('<h2>Parent</h2>');
    expect(content).toContain('<h3>Child</h3>');
  });

  it('should handle a componentless route module', async () => {
    const routes: StreamixRoutes = [
      {
        path: 'wrapper',
        load: () => ({
          routes: [
            { path: 'child', load: () => ({ component: ChildComponent }) },
          ],
        }),
      },
    ];

    await bootstrap(routes);
    await navigate('/wrapper/child');

    const content = getOutletContent();
    expect(content).not.toContain('<h2>');
    expect(content).toContain('<h3>Child</h3>');
  });
});
