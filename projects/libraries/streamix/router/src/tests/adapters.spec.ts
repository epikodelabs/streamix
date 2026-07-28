import { Component, Input } from '@angular/core';

import {
  adaptRouteComponent,
  bindRouteInputs,
  type StreamixRouteProviders,
} from '@epikodelabs/streamix/router';

@Component({
  template: '',
})
class TestRouteComponent {}

type ActivatedRoute = Parameters<typeof bindRouteInputs>[2];

function createRoute(
  overrides: Partial<ActivatedRoute> = {},
): ActivatedRoute {
  return {
    path: '/projects/42',
    params: {},
    query: {},
    data: {},
    ...overrides,
  } as ActivatedRoute;
}

describe('Streamix router adapters', () => {
  it('binds component inputs by template name first and falls back to prop name', () => {
    const target = {
      setInput: jasmine.createSpy('setInput'),
    };

    @Component({ template: '' })
    class TestInputsComponent {
      @Input('project-id') projectId!: number;
      @Input() user!: string;
      @Input() missing!: string;
    }

    const route = createRoute({
      params: {
        projectId: '7',
        section: 'overview',
      },
      query: {
        tab: 'activity',
        sort: 'oldest',
      },
      data: {
        'project-id': 42,
        user: 'Ada',
        __params: {
          projectId: 42,
        },
        __query: {
          tab: 'settings',
        },
        sort: 'recent',
      },
    });

    bindRouteInputs(target, TestInputsComponent, route);

    expect(target.setInput).toHaveBeenCalledTimes(2);
    expect(target.setInput).toHaveBeenCalledWith(
      'project-id',
      42,
    );
    expect(target.setInput).toHaveBeenCalledWith(
      'user',
      'Ada',
    );
  });

  it('returns the renderer-produced route component and passes route providers', () => {
    const providers: StreamixRouteProviders = [
      {
        provide: 'ROUTE_MESSAGE',
        useValue: 'scoped',
      },
    ];

    const rendered = jasmine.createSpy('rendered');
    const render = jasmine
      .createSpy('render')
      .and.returnValue(rendered);

    const context = {
      injector: {
        kind: 'injector',
      },
      render,
    } as any;

    const routeComponent = adaptRouteComponent(
      TestRouteComponent,
      context,
      providers,
    );

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(
      TestRouteComponent,
      context.injector,
      providers,
    );
    expect(routeComponent).toBe(rendered);
  });
});
