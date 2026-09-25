import {
  combineReactiveSourceResolvers,
  createDependencySourcePathResolver,
  createReactiveSourcePathResolver,
  createScopeValuePathResolver,
} from './source-resolution';

describe('sx reactive source resolution', () => {
  it('maps standalone sources to themselves', () => {
    const resolve = createDependencySourcePathResolver(['count']);

    expect(resolve('count')).toBe('count');
    expect(resolve('plain')).toBeUndefined();
  });

  it('maps value-first Scope members through recursive refs', () => {
    const resolve = createScopeValuePathResolver({
      model: ['count', 'user.name'],
    });

    expect(resolve('model.count')).toBe('model.refs.count');
    expect(resolve('model.user.name')).toBe('model.refs.user.name');
    expect(resolve('model.user')).toBeUndefined();
  });

  it('combines explicit, Scope and standalone metadata', () => {
    const resolve = combineReactiveSourceResolvers(
      createReactiveSourcePathResolver({
        'custom.value': 'custom.backing',
      }),
      createScopeValuePathResolver({
        model: ['count'],
      }),
      createDependencySourcePathResolver(['count']),
    )!;

    expect(resolve('custom.value')).toBe('custom.backing');
    expect(resolve('model.count')).toBe('model.refs.count');
    expect(resolve('count')).toBe('count');
  });
});
