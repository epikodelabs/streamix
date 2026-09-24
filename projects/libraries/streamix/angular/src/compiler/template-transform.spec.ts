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
