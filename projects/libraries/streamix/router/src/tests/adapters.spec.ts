import { Component } from '@angular/core';
import {
  adaptRouteComponent,
  bindRouteInputs,
  collectRouteInputValues,
  type RouteInputBinding,
} from '../lib/route-adapter';

@Component({ template: '' })
class TestRouteComponent {}

function createRoute(overrides: Partial<Parameters<typeof collectRouteInputValues>[0]> = {}) {
  return {
    path: '/projects/42',
    params: {},
    queryParams: {},
    data: {},
    ...overrides,
  } as Parameters<typeof collectRouteInputValues>[0];
}

describe('Streamix router adapters', () => {
  it('collects route input values from params, query, schema results, and resolved data', () => {
    const route = createRoute({
      params: { projectId: '42', section: 'overview' },
      queryParams: { tab: 'activity', sort: 'oldest' },
      data: {
        __params: { projectId: 42 },
        __search: { tab: 'settings' },
        sort: 'recent',
        userName: 'Ada',
      },
    });

    expect(collectRouteInputValues(route)).toEqual({
      projectId: 42,
      section: 'overview',
      tab: 'settings',
      sort: 'recent',
      userName: 'Ada',
    });
  });

  it('binds component inputs by template name first and falls back to prop name', () => {
    const target = { setInput: jasmine.createSpy('setInput') };
    const inputs: RouteInputBinding[] = [
      { templateName: 'project-id', propName: 'projectId' },
      { templateName: 'userName', propName: 'user' },
      { templateName: 'missing', propName: 'missing' },
    ];
    const route = createRoute({
      params: { projectId: '7' },
      data: { 'project-id': 42, user: 'Ada' },
    });

    bindRouteInputs(target, inputs, route);

    expect(target.setInput).toHaveBeenCalledTimes(2);
    expect(target.setInput).toHaveBeenCalledWith('project-id', 42);
    expect(target.setInput).toHaveBeenCalledWith('userName', 'Ada');
  });

  it('passes route providers to the eager component renderer', async () => {
    const component = TestRouteComponent;
    const providers = [{ provide: 'ROUTE_MESSAGE', useValue: 'scoped' }];
    const rendered = jasmine.createSpy('rendered');
    const render = jasmine.createSpy('render').and.returnValue(rendered);
    const context = {
      injector: { kind: 'injector' },
      render,
    } as any;

    const routeComponent = adaptRouteComponent(component, context, providers);
    const result = await routeComponent(createRoute(), {} as any);

    expect(render).toHaveBeenCalledWith(component, context.injector, providers);
    expect(result).toBe(rendered);
  });

  it('renders the same adapted component for each activation', async () => {
    const component = TestRouteComponent;
    const providers = [{ provide: 'ROUTE_MESSAGE', useValue: 'scoped' }];
    const rendered = jasmine.createSpy('rendered');
    const render = jasmine.createSpy('render').and.returnValue(rendered);
    const context = {
      injector: { kind: 'injector' },
      render,
    } as any;

    const routeComponent = adaptRouteComponent(component, context, providers);
    const first = await routeComponent(createRoute(), {} as any);
    const second = await routeComponent(createRoute(), {} as any);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(component, context.injector, providers);
    expect(first).toBe(rendered);
    expect(second).toBe(rendered);
  });
});
