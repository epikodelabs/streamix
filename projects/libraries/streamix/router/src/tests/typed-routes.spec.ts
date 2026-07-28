import { layout, route, s, type StreamixRoutes, type StreamixRouter } from '@epikodelabs/streamix/router';

class DashboardLayout {}
class DashboardPage {}
class SettingsPage {}

const routes = [
  layout('/app', DashboardLayout, [
    route('/dashboard/:projectId', DashboardPage, {
      name: 'dashboard',
      paramsSchema: {
        projectId: s.number({ min: 1 }),
      },
      querySchema: {
        tab: s.string('overview'),
        page: s.number({ default: 1, min: 1 }),
        filters: s.array(),
        draft: s.optional(s.boolean()),
      },
    }),
    route('/settings', SettingsPage, {
      name: 'settings',
      querySchema: {
        section: s.string('general'),
      },
    }),
  ]),
] as const satisfies StreamixRoutes;

function assertNamedNavigation(router: StreamixRouter<typeof routes>): void {
  void router.navigateTo.dashboard({
    params: { projectId: 123 },
  });

  void router.navigateTo.dashboard({
    params: { projectId: 123 },
    query: {
      tab: 'settings',
      page: 2,
      filters: ['a', 'b'],
      draft: true,
    },
  });

  void router.navigateTo.settings({
    query: { section: 'billing' },
  });

  const href = router.hrefTo.dashboard({
    params: { projectId: 123 },
    query: { tab: 'overview' },
  });

  const typedHref: string | null = href;
  void typedHref;

  // @ts-expect-error route name must exist in the configured layout tree
  void router.navigateTo.missing();
}

describe('typed routes typings', () => {
  it('discovers named leaf routes nested inside layouts', () => {
    expect(typeof assertNamedNavigation).toBe('function');
  });
});
