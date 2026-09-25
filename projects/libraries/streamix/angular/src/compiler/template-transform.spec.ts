import {
  transformSxTemplate,
} from './template-transform';

describe('transformSxTemplate', () => {
  it('removes sx bindings without emitting runtime markers', () => {
    const result = transformSxTemplate(`
      <span [sx.text]="count"></span>
      <button [sx.disabled]="disabled">Save</button>
    `);

    expect(result.template).not.toContain('[sx.text]');
    expect(result.template).not.toContain('[sx.disabled]');
    expect(result.template).not.toContain('data-sx');
    expect(result.parsed.plan.size).toBe(2);
  });

  it('removes single-quoted sx bindings from the template', () => {
    const result = transformSxTemplate(`<span [sx.text]='count'></span>`);

    expect(result.template).toBe('<span></span>');
    expect(result.parsed.plan.bindings[0]?.source).toBe('count');
  });

  it('removes multiple bindings of either quote style', () => {
    const result = transformSxTemplate(
      `<button [sx.disabled]='disabled' [sx.class.active]="active">Save</button>`,
    );

    expect(result.template).toBe('<button>Save</button>');
  });

  it('does not strip sx-looking text content', () => {
    const result = transformSxTemplate(
      `<span [sx.text]="count">[sx.text]="shadow"</span>`,
    );

    expect(result.template).toContain('[sx.text]="shadow"');
    expect(result.template).not.toContain('count');
  });
});

describe('automatic .value lowering', () => {
  it('removes direct text interpolation from Angular and owns the text binding', () => {
    const result = transformSxTemplate('<span>{{ count.value }}</span>');

    expect(result.template).toBe('<span></span>');
    expect(result.parsed.plan.bindings[0]).toEqual(
      jasmine.objectContaining({ kind: 'text', source: 'count' }),
    );
  });

  it('removes pure Streamix text expressions from Angular', () => {
    const result = transformSxTemplate(
      '<span>{{ count.value * 2 }}</span>',
    );

    expect(result.template).toBe('<span></span>');
    expect(result.parsed.plan.bindings[0]).toEqual(
      jasmine.objectContaining({
        kind: 'text-expression',
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

  it('removes simple native Angular .value bindings after direct lowering', () => {
    const result = transformSxTemplate(`
      <span>{{ count.value }}</span>
      <button
        [disabled]="busy.value"
        [attr.aria-label]="label.value"
        [class.active]="active.value"
        [style.opacity]="opacity.value">
        Save
      </button>
    `);

    expect(result.template).not.toContain('{{ count.value }}');
    expect(result.template).not.toContain('[disabled]');
    expect(result.template).not.toContain('[attr.aria-label]');
    expect(result.template).not.toContain('[class.active]');
    expect(result.template).not.toContain('[style.opacity]');
    expect(result.parsed.plan.size).toBe(5);
  });
});
