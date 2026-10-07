import {
  transformAngularComponentTemplate,
} from './build-transform';
import { stripAnyCasts } from './text-expression';

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

  it('compiles a compound @if condition whose reads are all reactive', () => {
    const result = transformAngularComponentTemplate(
      '@if (count > 3 && count < 10) { <p>a</p> }',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('sources: [ctx.count]');
    expect(result.setup).toContain(
      'read: () => ctx.count.value > 3 && ctx.count.value < 10',
    );
  });

  it('rejects a compound @if condition that reads untracked state', () => {
    expect(() => transformAngularComponentTemplate(
      '@if (count > threshold) { <p>a</p> }',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "count"/);
  });

  it('rejects atom reads in attribute interpolation', () => {
    expect(() => transformAngularComponentTemplate(
      '<span title="{{ count }}"></span>',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "count".*Attribute interpolation/s);
  });

  it('leaves attribute interpolation over plain state to Angular', () => {
    const template = '<span title="{{ plainTitle }}"></span>';
    const result = transformAngularComponentTemplate(
      template,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe(template);
  });

  it('keeps a block with attribute interpolation on the Angular path', () => {
    // The body cannot compile, so the block stays Angular-owned — and the
    // reactive read in its condition fails the build rather than rendering
    // once and never updating.
    expect(() => transformAngularComponentTemplate(
      `@if (ready) { <span title="{{ plainTitle }}"></span> }`,
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "ready"/);
  });

  it('rejects attribute interpolation when the block stays Angular-owned', () => {
    expect(() => transformAngularComponentTemplate(
      `@if (ready) { <span title="{{ count }}"></span> }`,
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind/);
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

/**
 * Angular's `$any(...)` cast is the per-expression way to silence the editor's
 * template type checker, which refuses a bare atom in operator positions
 * (`{{ count * 2 }}`, `@if (count > 3)`) and as a `@for` iterable. The compiled
 * view emits plain JavaScript, where no `$any` exists, so the cast has to be
 * transparent to the analysis and absent from the generated code — while
 * everything that fails loudly today keeps failing loudly inside it.
 */
describe('the $any() cast', () => {
  const resolveReactiveSource = (path: string) => ({
    count: 'count',
    rows: 'rows',
    'model.items': "model.get('items')",
  } as Record<string, string>)[path];

  it('compiles through a cast around a read', () => {
    const result = transformAngularComponentTemplate(
      '<span>{{ $any(count) * 2 }}</span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span>{{ count.value * 2 }}</span>');
    expect(result.setup).toContain('ctx.count.value * 2');
    expect(result.setup).not.toContain('$any');
  });

  it('compiles through a cast around the whole expression', () => {
    const result = transformAngularComponentTemplate(
      '<span>{{ $any(count + 1) }}</span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span>{{ count.value + 1 }}</span>');
    expect(result.setup).toContain('ctx.count.value + 1');
    expect(result.setup).not.toContain('$any');
  });

  it('compiles through nested casts', () => {
    const result = transformAngularComponentTemplate(
      '<span>{{ $any($any(count)) }}</span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span>{{ count.value }}</span>');
    expect(result.setup).toContain('ctx.count');
    expect(result.setup).not.toContain('$any');
  });

  it('compiles a cast in a property binding', () => {
    const result = transformAngularComponentTemplate(
      '<span [title]="$any(count)"></span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain('ctx.count');
    expect(result.setup).not.toContain('$any');
  });

  it('compiles a cast in a block condition', () => {
    const result = transformAngularComponentTemplate(
      '@if ($any(count) > 3) { <p>a</p> }',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain('ɵcreateSxConditionalBlock');
    expect(result.setup).toContain('ctx.count.value > 3');
    expect(result.setup).not.toContain('$any');
  });

  it('compiles a cast around a collection', () => {
    const result = transformAngularComponentTemplate(
      '@for (row of $any(rows); track row.id) { <p>{{ row.id }}</p> }',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain('ɵcreateSxKeyedBlock');
    expect(result.setup).not.toContain('$any');
  });

  it('leaves a cast over plain component state to Angular', () => {
    const template = '<span title="{{ $any(pageTitle) }}"></span>';
    const result = transformAngularComponentTemplate(
      template,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe(template);
  });

  it('does not treat a cast-looking string as a cast', () => {
    const template = "<span title=\"{{ '$any(count)' }}\"></span>";
    const result = transformAngularComponentTemplate(
      template,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe(template);
  });

  it('still rejects a cast that hides a pipe', () => {
    expect(() => transformAngularComponentTemplate(
      '<span>{{ $any(count) | uppercase }}</span>',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "count"/);
  });

  it('leaves an unclosed cast unchanged rather than truncating it', () => {
    expect(stripAnyCasts('$any(count')).toBe('$any(count');
  });

  it('leaves a member-accessed cast unchanged', () => {
    expect(stripAnyCasts('$any(count).value')).toBe('$any(count).value');
  });

  it('only strips the cast itself', () => {
    expect(stripAnyCasts('$any( $any(count) ) * 2')).toBe('count * 2');
    expect(stripAnyCasts("'$any(count)'")).toBe("'$any(count)'");
    expect(stripAnyCasts('foo.$any(count)')).toBe('foo.$any(count)');
    expect(stripAnyCasts('$anything(count)')).toBe('$anything(count)');
  });
});
