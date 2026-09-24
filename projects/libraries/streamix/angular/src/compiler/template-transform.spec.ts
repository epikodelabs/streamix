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
});
