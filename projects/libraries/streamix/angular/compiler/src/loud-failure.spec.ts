import {
  transformAngularComponentTemplate,
} from './build-transform';

/**
 * Every template position the compiler cannot take over must fail the build
 * when it reads a reactive source. A silent fallback there would render a
 * correct-looking value once and never update it.
 */
describe('reactive reads the compiler cannot own', () => {
  const resolveReactiveSource = (path: string) => ({
    count: 'count',
    ready: 'ready',
    'model.msg': "model.get('msg')",
    'model.ready': "model.get('ready')",
    'model.items': "model.get('items')",
  } as Record<string, string>)[path];

  it('rejects a native binding expression that mixes atoms with component state', () => {
    expect(() => transformAngularComponentTemplate(
      '<span [title]="model.msg + suffix"></span>',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "model\.get\('msg'\)".*mixes reactive reads/s);
  });

  it('rejects an interpolation that mixes atoms with component state', () => {
    expect(() => transformAngularComponentTemplate(
      '<span>{{ count * multiplier }}</span>',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "count".*mixes reactive reads/s);
  });

  it('still compiles an interpolation whose reads are all reactive', () => {
    const result = transformAngularComponentTemplate(
      '<span>{{ count * 2 }}</span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain('ɵsxTextExpressionNode');
  });

  it('leaves an expression that reads no reactive source alone', () => {
    const result = transformAngularComponentTemplate(
      '<span [title]="pageTitle">{{ pageTitle }}</span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toContain('[title]="pageTitle"');
    expect(result.template).toContain('{{ pageTitle }}');
    expect(result.setup).not.toContain('ɵsxProperty');
  });

  it('rejects a compound @if condition through the lowering scan', () => {
    expect(() => transformAngularComponentTemplate(
      '@if (count > 3 && count < 10) { <p>a</p> }',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "count"/);
  });

  it('rejects atom reads inside a @defer trigger and body', () => {
    expect(() => transformAngularComponentTemplate(
      '@defer (when count > 3) { <p>{{ count }}</p> }',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "count"/);
  });

  it('rejects atom reads in a root @let declaration', () => {
    expect(() => transformAngularComponentTemplate(
      '@let total = count * 2; <p>{{ total }}</p>',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "count"/);
  });

  it('keeps an unresolved @if on the Angular path', () => {
    const template = '@if (isReady) { <p>a</p> }';
    const result = transformAngularComponentTemplate(
      template,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe(template);
    expect(result.setup).not.toContain('ɵcreateSxConditionalBlock');
  });

  it('keeps static @defer and @let regions silent', () => {
    const template =
      '@defer (on viewport) { <p>lazy</p> } @let label = \'static\'; <p>{{ label }}</p>';
    const result = transformAngularComponentTemplate(
      template,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe(template);
  });
});
