import {
  compileSxBlockTemplate,
} from './block-template-compiler';
import { emitComponentSetup } from './emit-component-setup';

const resolver = (path: string): string | undefined => ({
  'model.items': 'model.get("items")',
  'model.suffix': 'model.get("suffix")',
  'model.rate': 'model.get("rate")',
  'model.enabled': 'model.get("enabled")',
})[path as 'model.items'];

const options = {
  allowLocals: true,
  localNames: ['row', '$index'],
  resolveReactiveSource: resolver,
};

describe('sx mixed loop-local/reactive block expressions', () => {
  it('lowers property and text expressions to one contextual slot per binding', () => {
    const compiled = compileSxBlockTemplate(
      '<li [title]="row.name + model.suffix">{{ row.price * model.rate }}</li>',
      'mixed.html', options,
    );

    expect(compiled.bindings.length).toBe(2);
    const [title, text] = compiled.bindings;
    expect(title.kind).toBe('property');
    expect(text.kind).toBe('text');
    if (title.kind === 'event' || text.kind === 'event') fail('Unexpected event binding');
    else {
      expect(title.contextual).toBeTrue();
      expect(text.contextual).toBeTrue();
      expect(title.dependencies).toEqual(['model.get("suffix")']);
      expect(text.dependencies).toEqual(['model.get("rate")']);
      expect(title.source).toContain('ɵsxReadLocal(currentContext, "row.name")');
      expect(title.source).toContain('ctx.model.get("suffix").value');
      expect(text.source).toContain('ɵsxReadLocal(currentContext, "row.price")');
    }
  });

  it('refreshes mixed slots when keyed row contexts change without rebinding sources', () => {
    const compiled = compileSxBlockTemplate(
      '<li [class.active]="row.active && model.enabled" [attr.title]="row.name + model.suffix"></li>',
      'mixed.html', options,
    );
    const emitted = emitComponentSetup({
      plan: { size: 0, bindings: [] },
      nodePaths: { marker: [0] },
      markers: { '0': 'marker' },
      nodeSelectors: {},
    } as unknown as Parameters<typeof emitComponentSetup>[0], 'ɵsetup', [{
      kind: 'collection', marker: '0',
      source: { kind: 'source', source: 'model.get("items")' },
      trackBy: '(_index, row) => row.id',
      item: 'row', aliases: [], compiled, fields: [],
    }]);
    expect(emitted).toContain('ɵsxClassExpression(blockTable, 0');
    expect(emitted).toContain('ɵsxAttributeExpression(blockTable, 1');
    expect(emitted).toContain('blockTable.refreshExpression(0);');
    expect(emitted).toContain('blockTable.refreshExpression(1);');
    expect(emitted).toContain('ctx.model.get("suffix").value');
  });

  it('keeps nested conditional sources reactive and contextual', () => {
    const compiled = compileSxBlockTemplate(
      '@if (row.visible && model.enabled) { <span [title]="row.name + model.suffix">Open</span> }',
      'mixed.html', options,
    );
    expect(compiled.nested.length).toBe(1);
    const nested = compiled.nested[0];
    expect(nested.kind).toBe('conditional');
    if (nested.kind === 'conditional') {
      expect(nested.branches[0].condition?.kind).toBe('expression');
      const condition = nested.branches[0].condition;
      if (condition?.kind === 'expression') {
        expect(condition.contextual).toBeTrue();
        expect(condition.dependencies).toEqual(['model.get("enabled")']);
      }
      const attribute = nested.branches[0].body.bindings[0];
      if (attribute.kind !== 'event') expect(attribute.contextual).toBeTrue();
    }
  });

  it('preserves local-only and reactive-only fast paths', () => {
    const compiled = compileSxBlockTemplate(
      '<li [title]="row.name" [class.active]="model.enabled">{{ row.name }}</li>',
      'mixed.html', options,
    );
    expect(compiled.updateBody).toContain('ɵsxReadLocal(currentContext, "row.name")');
    expect(compiled.bindings.length).toBe(1);
    expect(compiled.bindings[0].kind).toBe('class');
    if (compiled.bindings[0].kind !== 'event') {
      expect(compiled.bindings[0].contextual).toBeUndefined();
    }
  });

  it('samples component fields and component method results alongside loop locals', () => {
    const field = compileSxBlockTemplate(
      '<li [title]="row.name + plain + model.suffix"></li>', 'mixed.html', options,
    );
    const method = compileSxBlockTemplate(
      '<li [title]="format(row.name) + model.suffix"></li>', 'mixed.html', options,
    );
    const fieldBinding = field.bindings[0];
    const methodBinding = method.bindings[0];
    if (fieldBinding.kind === 'event' || methodBinding.kind === 'event') {
      fail('Expected reactive property bindings');
      return;
    }
    expect(fieldBinding.source).toContain('ctx.plain');
    expect(methodBinding.source).toContain('ctx.format(');
    expect(fieldBinding.source).toContain('ɵsxReadLocal(currentContext, "row.name")');
  });

  it('refuses assignments in mixed expressions', () => {
    // The Angular parser refuses the assignment before the compiler's own
    // mixed-expression validation runs; either refusal is a loud build error.
    expect(() => compileSxBlockTemplate(
      '<li [title]="(row.name = \'x\') + model.suffix"></li>',
      'mixed.html', options,
    )).toThrowError(/Unsupported mixed|Bindings cannot contain assignments/);
  });
});
