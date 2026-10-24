import {
  compileSxBlockTemplate,
} from './block-template-compiler';
import { jsStringLiteral } from './codegen';

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

  it('refuses a nested condition reading anything outside the declared loop context', () => {
    const options = {
      allowLocals: true,
      localNames: ['item', '$index', 'ready'],
    };

    expect(() =>
      compileSxBlockTemplate('@if (foreign) { <span>x</span> }', 'sx-block.html', options),
    ).toThrowError(/Unknown loop-local in sx block expression/);
    expect(() =>
      compileSxBlockTemplate('@if (foreignRoot.value) { <span>x</span> }', 'sx-block.html', options),
    ).toThrowError(/Unknown loop-local/);
    expect(() =>
      compileSxBlockTemplate('@for (row of foreignList; track row) { <span>x</span> }', 'sx-block.html', options),
    ).toThrowError(/Unknown loop-local/);
  });

  it('compiles nested conditions over the declared loop context', () => {
    const result = compileSxBlockTemplate(
      '@if (ready && $index > 1) { <span>{{ item.name }}</span> }',
      'sx-block.html',
      { allowLocals: true, localNames: ['item', '$index', 'ready'] },
    );

    expect(result.nested.length).toBe(1);
    expect(result.nested[0].kind).toBe('conditional');
  });

  it('embeds string literals without script-context breakouts', () => {
    const hostile = 'a</script>b\u2028c/d>e';
    const literal = jsStringLiteral(hostile);

    expect(literal).not.toMatch(/[<>/]/);
    expect(literal).not.toContain('\u2028');
    expect(literal).not.toContain('\u2029');
    // The escape sequences must reconstruct the identical runtime value.
    expect((0, eval)(literal)).toBe(hostile);
    expect(jsStringLiteral('user.profile.name')).toBe('"user.profile.name"');
    expect(jsStringLiteral(undefined)).toBe('undefined');
  });
});
