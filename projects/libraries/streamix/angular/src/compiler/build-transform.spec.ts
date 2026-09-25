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
      'ɵsxTextExpressionNode(table, 0, node0, [ctx.count], () => ctx.count.value * 2);',
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

describe('source-transparent build lowering', () => {
  const sources = new Set(['count', 'busy', 'label', 'active', 'opacity']);
  const isDependencySource = (path: string) => sources.has(path);

  it('rewrites source-transparent native bindings only in the Angular fallback', () => {
    const result = transformAngularComponentTemplate(`
      <span>{{ count }}</span>
      <strong>{{ count * 2 }}</strong>
      <button
        [disabled]="busy"
        [attr.aria-label]="label"
        [class.active]="active"
        [style.opacity]="opacity">
        Save
      </button>
    `, 'inline.html', { isDependencySource });

    expect(result.bindingCount).toBe(6);
    expect(result.template).toContain('{{ count.value }}');
    expect(result.template).toContain('{{ count.value * 2 }}');
    expect(result.template).toContain('[disabled]="busy.value"');
    expect(result.template).toContain('[attr.aria-label]="label.value"');
    expect(result.template).toContain('[class.active]="active.value"');
    expect(result.template).toContain('[style.opacity]="opacity.value"');

    expect(result.setup).toContain(
      'ɵsxTextNode(table, 0, node0, ctx.count);',
    );
    expect(result.setup).toContain(
      'ɵsxTextExpressionNode(table, 1, node1, [ctx.count], () => ctx.count.value * 2);',
    );
    expect(result.setup).toContain(
      'ɵsxProperty(table, 2, node2, "disabled", ctx.busy);',
    );
  });

  it('leaves ordinary Angular values untouched', () => {
    const result = transformAngularComponentTemplate(
      '<button [disabled]="plainBusy">{{ plainCount }}</button>',
      'inline.html',
      { isDependencySource },
    );

    expect(result.bindingCount).toBe(0);
    expect(result.template).toBe(
      '<button [disabled]="plainBusy">{{ plainCount }}</button>',
    );
  });

  it('keeps sanitizer-sensitive bindings Angular-owned while still unwrapping transparent sources', () => {
    const unsafeSources = new Set(['url', 'html', 'image', 'background']);
    const result = transformAngularComponentTemplate(`
      <a [href]="url">link</a>
      <div [innerHTML]="html"></div>
      <img [src]="image">
      <div [attr.href]="url"></div>
      <div [style.background-image]="background"></div>
    `, 'inline.html', {
      isDependencySource: path => unsafeSources.has(path),
    });

    expect(result.bindingCount).toBe(0);
    expect(result.template).toContain('[href]="url.value"');
    expect(result.template).toContain('[innerHTML]="html.value"');
    expect(result.template).toContain('[src]="image.value"');
    expect(result.template).toContain('[attr.href]="url.value"');
    expect(result.template).toContain('[style.background-image]="background.value"');
  });

  it('rejects explicit direct bindings that bypass Angular sanitization', () => {
    expect(() => transformAngularComponentTemplate(
      '<a [sx.href]="url"></a>',
    )).toThrowError(/sanitization/i);

    expect(() => transformAngularComponentTemplate(
      '<div [sx.style.background-image]="background"></div>',
    )).toThrowError(/sanitization/i);
  });
});
