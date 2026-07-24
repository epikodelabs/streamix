import { s } from '../lib/search-schema';
import type {
  StreamixRouter,
  StreamixRoutes,
} from '../lib/streamix-router';

const routes = [
  {
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
    path: 'settings',
    searchSchema: {
      section: s.string('general'),
    },
  },
] as const satisfies StreamixRoutes;

function assertTypedNavigation(router: StreamixRouter<typeof routes>): void {
  void router.typed.navigate('dashboard/:projectId', { projectId: 123 });
  void router.typed.navigate('dashboard/:projectId', { projectId: 123 }, {
    search: {
      tab: 'settings',
      page: 2,
      filters: ['a', 'b'],
      draft: true,
    },
  });
  void router.typed.navigate('settings', {
    search: {
      section: 'billing',
    },
  });

  const href = router.typed.href('dashboard/:projectId', { projectId: 123 }, {
    search: {
      tab: 'overview',
    },
  });

  const typedHref: string = href;
  void typedHref;

  // @ts-expect-error missing required params
  void router.typed.navigate('dashboard/:projectId');
  // @ts-expect-error projectId must be a number
  void router.typed.navigate('dashboard/:projectId', { projectId: '123' });
  // @ts-expect-error route path must exist in the route tree
  void router.typed.navigate('missing');
  // @ts-expect-error search values must match the configured schema
  void router.typed.navigate('dashboard/:projectId', { projectId: 123 }, { search: { tab: 123 } });
}

describe('typed routes typings', () => {
  it('should compile typed navigation helpers', () => {
    expect(typeof assertTypedNavigation).toBe('function');
  });
});
