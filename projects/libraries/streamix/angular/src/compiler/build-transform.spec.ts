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

describe('automatic .value build lowering', () => {
  it('emits direct and expression bindings for automatic .value lowering', () => {
    const result = transformAngularComponentTemplate(`
      <span>{{ count.value * 2 }}</span>
      <button [disabled]="busy.value"></button>
    `);

    expect(result.bindingCount).toBe(2);
    expect(result.setup).toContain(
      'ɵsxTextExpression(table, 0, node0, [ctx.count], () => ctx.count.value * 2);',
    );
    expect(result.setup).toContain(
      'ɵsxProperty(table, 1, node1, "disabled", ctx.busy);',
    );
  });

  it('emits Streamix invalidation for hybrid Angular interpolation', () => {
    const result = transformAngularComponentTemplate(
      '<span>{{ count.value * multiplier }}</span>',
    );

    expect(result.template).toContain('{{ count.value * multiplier }}');
    expect(result.setup).toContain(
      'ɵsxInvalidate(table, 0, [ctx.count], invalidate);',
    );
  });

});
