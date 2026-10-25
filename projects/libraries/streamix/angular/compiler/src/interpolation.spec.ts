import { transformAngularComponentTemplate } from './build-transform';
import { parseSxTemplate } from './angular-template-parser';
import { rewriteSxTextExpression } from './text-expression';

describe('Angular interpolation combinations', () => {
  const resolveReactiveSource = (path: string) => ({
    count: 'count', other: 'other', user: 'user', items: 'items',
    'model.rate': "model.get('rate')",
  } as Record<string, string>)[path];
  const compile = (template: string) => transformAngularComponentTemplate(
    template, 'interpolation.html', { resolveReactiveSource },
  );

  it('supports representative atom/scoped/plain expression forms', () => {
    for (const expression of [
      'count * model.rate * multiplier',
      "config.factor * model.get('rate').value * count.value",
      'this.count * this.multiplier',
      'count ? label : fallback', 'user?.name ?? label',
      'items[index]', 'format(count)', '$any(count) * multiplier',
    ]) {
      const result = compile('<p>{{ ' + expression + ' }}</p>');
      expect(result.bindingCount).withContext(expression).toBe(1);
      expect(result.setup).withContext(expression).not.toContain('.value.value');
      expect(result.setup).withContext(expression).not.toContain('ctx.ctx.');
    }
  });

  it('supports literal, repeated and quoted-brace interpolation runs', () => {
    for (const content of [
      '{{ label }}: {{ count }} / {{ model.rate }} {{ unit }}',
      '{{ count }}{{ count.value }}', '{{ count }} and {{ "}}" }}',
    ]) {
      const result = compile('<p>' + content + '</p>');
      expect(result.bindingCount).withContext(content).toBe(1);
      expect(result.setup).toContain('ɵsxTextExpressionNode');
    }
  });

  it('compiles standalone atom/value reads mixed with variables in a compiled block', () => {
    const result = compile('@if (count) { <p>{{ count.value * multiplier }} {{ other + offset }}</p> }');
    expect(result.structuralBlockCount).toBe(1);
    expect(result.setup).toContain('ctx.count.value * ctx.multiplier');
    expect(result.setup).toContain('ctx.other.value + ctx.offset');
  });

  it('mixes loop locals with standalone/scoped atoms and plain variables', () => {
    const result = compile('@for (row of items; track row.id) { <p>{{ row.factor * count * model.rate * multiplier }}</p> }');
    expect(result.structuralBlockCount).toBe(1);
    expect(result.setup).toContain('ɵsxReadLocal(currentContext, "row.factor")');
    expect(result.setup).toContain('ctx.count.value');
    expect(result.setup).toContain("ctx.model.get('rate').value");
    expect(result.setup).toContain('ctx.multiplier');
  });

  it('qualifies plain roots, method receivers and shorthand object values', () => {
    expect(rewriteSxTextExpression('format(count.value, { label, key: config.offset })', 'ctx', true))
      .toBe('ctx.format(ctx.count.value, { label: ctx.label, key: ctx.config.offset })');
  });

  it('subscribes only to proven atoms, deduplicating repeated reads', () => {
    const parsed = parseSxTemplate('<p>{{ count }} {{ count.value + dto.value }} {{ model.rate }}</p>',
      'test.html', { resolveReactiveSource });
    expect(parsed.plan.bindings[0].dependencies).toEqual(['count', "model.get('rate')"]);
  });

  it('supports mixed title, ARIA and data interpolation', () => {
    for (const attribute of ['title', 'aria-label', 'data-label']) {
      const result = compile('<p ' + attribute + '="{{ label }}: {{ count }} / {{ model.rate }}"></p>');
      expect(result.setup).withContext(attribute).toContain('ɵsxAttributeExpression');
      expect(result.setup).toContain('ctx.label');
      expect(result.setup).toContain("[ctx.count, ctx.model.get('rate')]");
    }
  });

  it('preserves child elements between independent text bindings', () => {
    const result = compile('<p>{{ count }}<strong>fixed</strong>{{ label }} {{ other }}</p>');
    expect(result.bindingCount).toBe(2);
    expect(result.setup).toContain('ctx.count, 0)');
    expect(result.setup).toContain('.join(""), 1)');
    expect(result.template).toContain('<strong>fixed</strong>');
  });

  it('supports standalone interpolation at the component root', () => {
    const result = compile('{{ label }}: {{ count }}');
    expect(result.bindingCount).toBe(1);
    expect(result.setup).toContain('= host as HTMLElement');
  });

  it('leaves plain-only interpolation Angular-owned', () => {
    const template = '<p title="{{ label }}">{{ label }} / {{ config.offset }}</p>';
    const result = compile(template);
    expect(result.template).toBe(template);
    expect(result.bindingCount).toBe(0);
  });

  it('does not reinterpret ordinary value properties as atoms', () => {
    expect(compile('<p>{{ dto.value }}</p>').bindingCount).toBe(0);
  });

  it('retains sanitizer boundaries for interpolated URLs', () => {
    expect(() => compile('<a href="{{ count }}">link</a>')).toThrowError(/sanitization/);
  });

  it('refuses Angular pipes even in a separate plain interpolation run', () => {
    expect(() => compile('<p>{{ count }} {{ label | uppercase }}</p>')).toThrow();
  });
});
