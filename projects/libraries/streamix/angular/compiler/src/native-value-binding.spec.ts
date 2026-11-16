import { transformAngularComponentTemplate } from './build-transform';

describe('native .value binding ownership', () => {
  const options = { resolveReactiveSource: (path: string) => path === 'count' ? 'count' : undefined };

  for (const binding of ['[title]="dto.value"', '[value]="control.value"', '[attr.x]="ref.value"', '[attr.aria-label]="form.value"', '[class.x]="model.value"']) {
    it(`leaves ${binding} to Angular without reactive proof`, () => {
      const template = `<input ${binding}>`;
      const result = transformAngularComponentTemplate(template, 'native.html', options);
      expect(result.template).toBe(template);
      expect(result.bindingCount).toBe(0);
      expect(result.sourceReferenceFields).toEqual([]);
    });
  }

  it('leaves an explicit value binding to Angular when no resolver is supplied', () => {
    const template = '<input [value]="control.value">';
    const result = transformAngularComponentTemplate(template);
    expect(result.template).toBe(template);
    expect(result.bindingCount).toBe(0);
  });

  it('compiles a proven reactive receiver', () => {
    const result = transformAngularComponentTemplate('<span [title]="count.value"></span>', 'native.html', options);
    expect(result.bindingCount).toBe(1);
    expect(result.setup).toContain('ɵsxProperty(table, 0, node0, "title", ctx.count)');
    expect(result.sourceReferenceFields).toEqual(['count']);
  });

  it('uses the source returned by the resolver', () => {
    const result = transformAngularComponentTemplate('<span [title]="count.value"></span>', 'native.html', {
      resolveReactiveSource: path => path === 'count' ? "model.get('count')" : undefined,
    });
    expect(result.setup).toContain('"title", ctx.model.get(\'count\')');
  });

  it('keeps ordinary value bindings in projected content Angular-owned', () => {
    const template = '<app-card><input [value]="$any(control.value)"></app-card>';
    const result = transformAngularComponentTemplate(template, 'native.html', options);
    expect(result.template).toBe(template);
    expect(result.bindingCount).toBe(0);
  });

  it('still rejects proven reactive value bindings in projected content', () => {
    expect(() => transformAngularComponentTemplate('<app-card><input [value]="$any(count.value)"></app-card>',
      'native.html', options)).toThrowError(/projection|static element topology/i);
  });
});
