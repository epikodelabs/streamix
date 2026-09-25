import {
  transformSxTemplate,
} from './template-transform';

describe('transformSxTemplate', () => {
  it('rewrites explicit sx bindings to Angular-native SSR/hydration fallbacks', () => {
    const result = transformSxTemplate(`
      <span [sx.text]="count"></span>
      <button
        [sx.disabled]="disabled"
        [sx.attr.aria-label]="label"
        [sx.class.active]="active"
        [sx.style.opacity]="opacity">
        Save
      </button>
    `);

    expect(result.template).toContain('[textContent]="count.value"');
    expect(result.template).toContain('[disabled]="disabled.value"');
    expect(result.template).toContain('[attr.aria-label]="label.value"');
    expect(result.template).toContain('[class.active]="active.value"');
    expect(result.template).toContain('[style.opacity]="opacity.value"');
    expect(result.template).not.toContain('[sx.');
    expect(result.template).not.toContain('data-sx');
    expect(result.parsed.plan.size).toBe(5);
  });

  it('normalizes single-quoted explicit sx bindings to fallback bindings', () => {
    const result = transformSxTemplate(`<span [sx.text]='count'></span>`);

    expect(result.template).toBe('<span [textContent]="count.value"></span>');
    expect(result.parsed.plan.bindings[0]?.source).toBe('count');
  });

  it('does not rewrite sx-looking text content', () => {
    const result = transformSxTemplate(
      `<span [sx.text]="count">[sx.text]="shadow"</span>`,
    );

    expect(result.template).toContain('[textContent]="count.value"');
    expect(result.template).toContain('[sx.text]="shadow"');
  });
});

describe('automatic .value lowering', () => {
  it('preserves direct text interpolation for SSR/hydration and owns its text node', () => {
    const template = '<span>{{ count.value }}</span>';
    const result = transformSxTemplate(template);

    expect(result.template).toBe(template);
    expect(result.parsed.plan.bindings[0]).toEqual(
      jasmine.objectContaining({ kind: 'text-node', source: 'count' }),
    );
  });

  it('preserves pure Streamix text expressions for SSR/hydration', () => {
    const template = '<span>{{ count.value * 2 }}</span>';
    const result = transformSxTemplate(template);

    expect(result.template).toBe(template);
    expect(result.parsed.plan.bindings[0]).toEqual(
      jasmine.objectContaining({
        kind: 'text-expression-node',
        dependencies: ['count'],
      }),
    );
  });

  it('preserves hybrid interpolation for Angular while adding invalidation', () => {
    const template = '<span>{{ count.value * multiplier }}</span>';
    const result = transformSxTemplate(template);

    expect(result.template).toBe(template);
    expect(result.parsed.plan.bindings[0]).toEqual(
      jasmine.objectContaining({
        kind: 'angular-invalidate',
        dependencies: ['count'],
      }),
    );
  });

  it('preserves native Angular .value bindings as SSR/hydration fallbacks', () => {
    const template = `
      <span>{{ count.value }}</span>
      <button
        [disabled]="busy.value"
        [attr.aria-label]="label.value"
        [class.active]="active.value"
        [style.opacity]="opacity.value">
        Save
      </button>
    `;
    const result = transformSxTemplate(template);

    expect(result.template).toBe(template);
    expect(result.parsed.plan.size).toBe(5);
  });
});

describe('source-transparent fallback-only transforms', () => {
  it('rewrites sanitizer-sensitive sources to .value without generating a direct binding', () => {
    const result = transformSxTemplate(
      '<a [href]="url">open</a>',
      'inline.html',
      { isDependencySource: path => path === 'url' },
    );

    expect(result.template).toBe('<a [href]="url.value">open</a>');
    expect(result.parsed.plan.size).toBe(0);
  });
});
