import {
  transformAngularComponentTemplate,
} from './build-transform';

describe('transformAngularComponentTemplate', () => {
  it('emits direct static-node acquisition and binding setup', () => {
    const result = transformAngularComponentTemplate(`
      <span [sx.text]="count"></span>
      <button [sx.disabled]="disabled"></button>
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.template).not.toContain('data-sx');
    expect(result.setup).toContain(
      'const node0 = host.children[0] as Element;',
    );
    expect(result.setup).toContain(
      'const node1 = host.children[1] as Element;',
    );
    expect(result.setup).not.toContain('querySelector');
    expect(result.setup).toContain(
      'ɵsxText(table, 0, node0, ctx.count);',
    );
    expect(result.setup).toContain(
      'ɵsxProperty(table, 1, node1, "disabled", ctx.disabled);',
    );
  });
});
