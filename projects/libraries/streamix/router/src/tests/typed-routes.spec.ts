import { s } from '../lib/search-schema';
import type { StreamixRouter } from '../lib/streamix-router';
import type { StreamixRoutes } from '../lib/route-types';

const routes = [
  {
    name: 'dashboard',
    path: 'dashboard/:projectId',
    paramsSchema: {
      projectId: s.number({ min: 1 }),
    },
    searchSchema: {
      tab: s.string('overview'),
      page: s.number({ default: 1, min: 1 }),
      filters: s.array(),
      draft: s.optional(s.boolean()),
    },
  },
  {
    name: 'settings',
    path: 'settings',
    searchSchema: {
      section: s.string('general'),
    },
  },
] as const satisfies StreamixRoutes;

function assertNamedNavigation(router: StreamixRouter<typeof routes>): void {
  void router.navigateTo.dashboard({
    params: { projectId: 123 },
  });
  void router.navigateTo.dashboard({
    params: { projectId: 123 },
    search: {
      tab: 'settings',
      page: 2,
      filters: ['a', 'b'],
      draft: true,
    },
  });
  void router.navigateTo.settings({
    search: { section: 'billing' },
  });

  const href = router.hrefTo.dashboard({
    params: { projectId: 123 },
    search: { tab: 'overview' },
  });

  const typedHref: string | null = href;
  void typedHref;

  // Current implementation types route names, while params/search remain runtime-schema validated.
  // @ts-expect-error route name must exist in the configured route tree
  void router.navigateTo.missing();
}

describe('typed routes typings', () => {
  it('should compile named navigation helpers', () => {
    expect(typeof assertNamedNavigation).toBe('function');
  });
});
