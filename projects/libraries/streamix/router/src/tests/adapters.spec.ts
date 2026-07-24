import '@angular/compiler';
import 'zone.js';

import { Component, inject } from '@angular/core';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { TestBed } from '@angular/core/testing';

import {
  STREAMIX_ROUTE,
  StreamixLink,
  StreamixOutlet,
  StreamixRouter,
  provideStreamixRouter,
  type StreamixRoutes,
} from '../lib/streamix-router';
import { idescribe } from './env.spec';

TestBed.initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);

@Component({ standalone: true, template: 'Streamix page: {{ route.path }}' })
class StreamixRoutePage {
  readonly route = inject(STREAMIX_ROUTE);
}

@Component({ standalone: true, template: 'Streamix params: {{ route.data.__params?.projectId }}' })
class StreamixParamsPage {
  readonly route = inject(STREAMIX_ROUTE);
}

@Component({
  standalone: true,
  imports: [StreamixLink, StreamixOutlet],
  template: '<a streamixLink="/page">Page</a><streamix-outlet></streamix-outlet>',
})
class StreamixRouterHost {}

@Component({
  standalone: true,
  imports: [StreamixLink, StreamixOutlet],
  template: '<a streamixLink="edit">Edit</a><streamix-outlet></streamix-outlet>',
})
class StreamixRelativeLinkHost {}

@Component({
  standalone: true,
  imports: [StreamixOutlet],
  template: '<streamix-outlet (activate)="onActivate($event)" (deactivate)="onDeactivate($event)" />',
})
class StreamixParentPage {
  static activated: unknown[] = [];
  static deactivated: unknown[] = [];

  onActivate(component: unknown): void {
    StreamixParentPage.activated.push(component);
  }

  onDeactivate(component: unknown): void {
    StreamixParentPage.deactivated.push(component);
  }
}

@Component({
  standalone: true,
  selector: 'streamix-child-page',
  template: 'Nested Streamix page',
})
class StreamixChildPage {}

@Component({
  standalone: true,
  selector: 'streamix-other-page',
  template: 'Other Streamix page',
})
class StreamixOtherPage {}

idescribe('Streamix router adapters', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    window.history.replaceState(null, '', '/');
  });

  it('mounts Streamix components and resolves links with its base href', async () => {
    window.history.replaceState(null, '', '/app/');
    const routes: StreamixRoutes = [
      { path: 'page', component: StreamixRoutePage },
    ];
    const fixture = TestBed.configureTestingModule({
      imports: [StreamixRouterHost],
      providers: [provideStreamixRouter(routes, { baseHref: '/app/' })],
    }).createComponent(StreamixRouterHost);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/page');

    const router = TestBed.inject(StreamixRouter);
    await router.navigate('/app/page');

    expect(fixture.nativeElement.textContent).toContain('Streamix page: /page');
    expect(router.state.current?.config.path).toBe('page');
  });

  it('parses paramsSchema values for Streamix components', async () => {
    const routes: StreamixRoutes = [
      {
        path: 'projects/:projectId',
        component: StreamixParamsPage,
        paramsSchema: {
          projectId: {
            _type: 'number',
            min: 1,
          },
        },
      },
    ];
    const fixture = TestBed.configureTestingModule({
      imports: [StreamixRouterHost],
      providers: [provideStreamixRouter(routes)],
    }).createComponent(StreamixRouterHost);
    fixture.detectChanges();

    const router = TestBed.inject(StreamixRouter);
    await router.navigate('/projects/42');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Streamix params: 42');
    expect(router.state.current?.data['__params']).toEqual({ projectId: 42 });
  });

  it('refreshes StreamixLink href when navigation changes the relative base URL', async () => {
    const routes: StreamixRoutes = [
      { path: 'users/:id', component: StreamixRoutePage },
      { path: 'teams/:id', component: StreamixRoutePage },
    ];
    const fixture = TestBed.configureTestingModule({
      imports: [StreamixRelativeLinkHost],
      providers: [provideStreamixRouter(routes)],
    }).createComponent(StreamixRelativeLinkHost);
    fixture.detectChanges();

    const router = TestBed.inject(StreamixRouter);
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;

    await router.navigate('/users/123');
    fixture.detectChanges();
    expect(link.getAttribute('href')).toBe('/users/edit');

    await router.navigate('/teams/123');
    fixture.detectChanges();
    expect(link.getAttribute('href')).toBe('/teams/edit');
  });

  it('emits lifecycle events from nested Streamix outlets', async () => {
    StreamixParentPage.activated = [];
    StreamixParentPage.deactivated = [];
    const routes: StreamixRoutes = [
      {
        path: 'parent',
        component: StreamixParentPage,
        children: [{ path: 'child', component: StreamixChildPage }],
      },
      { path: 'other', component: StreamixOtherPage },
    ];
    const fixture = TestBed.configureTestingModule({
      imports: [StreamixRouterHost],
      providers: [provideStreamixRouter(routes)],
    }).createComponent(StreamixRouterHost);
    fixture.detectChanges();

    const router = TestBed.inject(StreamixRouter);
    await router.navigate('/parent/child');
    expect(StreamixParentPage.activated.length).toBe(1);
    expect(StreamixParentPage.activated[0]).toEqual(jasmine.any(StreamixChildPage));

    await router.navigate('/other');
    expect(StreamixParentPage.deactivated.length).toBe(1);
    expect(StreamixParentPage.deactivated[0]).toEqual(jasmine.any(StreamixChildPage));
  });
});
