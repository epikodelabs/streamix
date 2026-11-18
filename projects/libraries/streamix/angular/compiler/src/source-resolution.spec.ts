import {
  combineReactiveSourceResolvers,
  createDependencySourcePathResolver,
  createReactiveSourcePathResolver,
  createScopeValuePathResolver,
  createScopeWritableResolver,
} from './source-resolution';

describe('sx reactive source resolution', () => {
  it('maps standalone sources to themselves', () => {
    const resolve = createDependencySourcePathResolver(['count']);

    expect(resolve('count')).toBe('count');
    expect(resolve('plain')).toBeUndefined();
  });

  it('maps value-first Scope members to their public atom accessors', () => {
    const resolve = createScopeValuePathResolver({
      model: ['count', 'user.name'],
    });

    expect(resolve('model.count')).toBe("model.get('count')");
    expect(resolve('model.user.name')).toBe("model.get('user').get('name')");
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
    expect(resolve('model.count')).toBe("model.get('count')");
    expect(resolve('count')).toBe('count');
  });

  it('uses Scope.set for writable template paths', () => {
    const resolve = createScopeWritableResolver({ model: ['title', 'user.name'] });
    const target = resolve('model.title');

    expect(target?.source).toBe("model.get('title')");
    expect(target?.write('nextTitle')).toBe("ctx.model.set('title', nextTitle)");
    expect(resolve('model.missing')).toBeUndefined();

    const nested = resolve('model.user.name');
    expect(nested?.source).toBe("model.get('user').get('name')");
    expect(nested?.write('nextName')).toBe("ctx.model.get('user').set('name', nextName)");
  });
});
