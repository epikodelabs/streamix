import {
  transformAngularComponentTemplate,
} from './build-transform';

describe('standard Angular atom templates', () => {
  const resolveReactiveSource = (path: string) => ({
    count: 'count',
    'model.ready': 'model.refs.ready',
    'model.message': 'model.refs.message',
    'model.items': 'model.refs.items',
    'model.status': 'model.refs.status',
  } as Record<string, string>)[path];

  it('compiles standard static Angular bindings', () => {
    const result = transformAngularComponentTemplate(
      '<button [disabled]="count">{{ count }}</button>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toContain('[disabled]="count.value"');
    expect(result.template).toContain('{{ count.value }}');
    expect(result.setup).toContain('ɵsxProperty');
    expect(result.setup).toContain('ɵsxTextNode');
  });

  it('refreshes all scoped atoms read by native and classic structural blocks', () => {
    const result = transformAngularComponentTemplate(`
      @if (model.ready) { <p>{{ model.message }}</p> }
      <li *ngFor="let item of model.items">{{ item.name }}</li>
      <section [ngSwitch]="model.status"></section>
    `, 'inline.html', { resolveReactiveSource });

    expect(result.template).toContain('@if (model.refs.ready.value)');
    expect(result.template).toContain('{{ model.refs.message.value }}');
    expect(result.template).toContain('*ngFor="let item of model.refs.items.value"');
    expect(result.template).toContain('[ngSwitch]="model.refs.status.value"');
    expect(result.requiresAngularInvalidation).toBeTrue();
    for (const source of ['ready', 'message', 'items', 'status']) {
      expect(result.setup).toContain(`[ctx.model.refs.${source}], invalidate)`);
    }
  });

  it('does not reinterpret atom-like static text in a structural block', () => {
    const result = transformAngularComponentTemplate(
      '@if (model.ready) { <p title="model.message">{{ model.message }}</p> }',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toContain('title="model.message"');
    expect(result.template).toContain('{{ model.refs.message.value }}');
  });

  it('rejects the removed Streamix structural directive', () => {
    expect(() => transformAngularComponentTemplate(
      '<span *sx="count as value">{{ value }}</span>',
    )).toThrowError(/legacy Streamix structural directive/i);
  });
});
