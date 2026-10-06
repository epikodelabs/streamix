import {
  compileSxBlockTemplate,
} from './block-template-compiler';

describe('compiled structural template diagnostics', () => {
  it('supports nested property interpolation', () => {
    const result = compileSxBlockTemplate(
      '<span>{{ user.profile.name }}</span>',
    );

    expect(result.updateBody).toContain(
      'ɵsxReadLocal(currentContext, "user.profile.name")',
    );
  });

  it('rejects executable interpolation expressions without a resolver', () => {
    expect(() =>
      compileSxBlockTemplate(
        '<span>{{ format(user) }}</span>',
      ),
    ).toThrowError(/only local\/property reads/i);
  });

  it('compiles structural control flow inside a direct block', () => {
    const result = compileSxBlockTemplate(
      '@if (visible) { <span>Visible</span> }',
      'sx-block.html',
      { allowLocals: true },
    );

    expect(result.nested.length).toBe(1);
    expect(result.nested[0].kind).toBe('conditional');
    expect(result.createBody).toContain('createComment("sx")');
  });

  it('rejects an executable nested block source without a resolver', () => {
    expect(() =>
      compileSxBlockTemplate(
        '@if (visible) { <span>Visible</span> }',
      ),
    ).toThrowError(/unsupported sx block expression/i);
  });
});
