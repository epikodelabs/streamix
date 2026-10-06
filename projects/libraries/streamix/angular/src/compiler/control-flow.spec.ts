import {
  transformAngularComponentTemplate,
} from './build-transform';

describe('standard Angular atom templates', () => {
  const resolveReactiveSource = (path: string) => ({
    count: 'count',
    'model.ready': "model.get('ready')",
    'model.message': "model.get('message')",
    'model.items': "model.get('items')",
    'model.status': "model.get('status')",
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

  it('lowers a pure @if/@else block to a direct-DOM conditional block', () => {
    const result = transformAngularComponentTemplate(
      `@if (model.ready) { <p class="msg">{{ model.message }}</p> } @else { <p>waiting</p> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('ɵcreateSxConditionalBlock');
    expect(result.setup).toContain("ctx.model.get('ready')");
    expect(result.setup).toContain(
      "ɵsxTextNode(blockTable, 0, el0, ctx.model.get('message'))",
    );
    expect(result.sourceReferenceFields).toContain('model');
  });

  it('lowers the compiler-owned block and rejects the classic directive beside it', () => {
    expect(() => transformAngularComponentTemplate(`
      @if (model.ready) { <p>{{ model.message }}</p> }
      <li *ngFor="let item of model.items">{{ item.name }}</li>
    `, 'inline.html', { resolveReactiveSource }))
      .toThrowError(/cannot bind "model.items"/);
  });

  it('lowers a pure @switch block with literal cases and a default', () => {
    const result = transformAngularComponentTemplate(
      `@switch (model.status) { @case ('ready') { <p>ready</p> } @case ('waiting') { <p>waiting</p> } @default { <p>unknown</p> } }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('ɵcreateSxConditionalBlock');
    expect(result.setup).toContain("source: ctx.model.get('status')");
    expect(result.setup).toContain("match: 'ready'");
    expect(result.setup).toContain("match: 'waiting'");
    // `@default` is the null-source branch and must come last.
    const defaultIndex = result.setup.indexOf('source: null');
    expect(defaultIndex).toBeGreaterThan(result.setup.indexOf("match: 'waiting'"));
  });

  it('keeps non-literal @case values on the Angular path', () => {
    expect(() => transformAngularComponentTemplate(
      `@switch (model.status) { @case (model.message) { <p>a</p> } }`,
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "model\.status"/);
  });

  it('rejects atom reads inside Angular-owned impure blocks', () => {
    expect(() => transformAngularComponentTemplate(
      `@if (model.ready) { <app-item [label]="model.message"></app-item> }`,
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/cannot bind "model.ready"/);
  });

  it('does not reinterpret atom-like static text in a structural block', () => {
    const result = transformAngularComponentTemplate(
      '@if (model.ready) { <p title="model.message">{{ model.message }}</p> }',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('setAttribute("title", "model.message")');
    expect(result.setup).toContain(
      "ɵsxTextNode(blockTable, 0, el0, ctx.model.get('message'))",
    );
  });

  it('lowers a pure @for/@empty block to a direct-DOM keyed block', () => {
    const result = transformAngularComponentTemplate(
      `@for (item of model.items; track item.id) { <li class="row">{{ item.name }}</li> } @empty { <li>none</li> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('ɵcreateSxKeyedBlock');
    expect(result.setup).toContain("ctx.model.get('items')");
    expect(result.setup).toContain('(_index, item) => item.id');
    expect(result.setup).toContain(
      'ɵsxString(ɵsxReadLocal(context, "item.name"))',
    );
    expect(result.setup).toContain('instance.update({ item, index,');
  });

  it('lowers a @for body that reads the full loop context', () => {
    const result = transformAngularComponentTemplate(
      `@for (item of model.items; track item.id) { <li>{{ $index }}/{{ $count }}: {{ item.name }}</li> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('ɵcreateSxKeyedBlock');
    expect(result.setup).toContain('count: count');
    expect(result.setup).toContain('$count: count');
    expect(result.setup).toContain('$last: index === count - 1');
    expect(result.setup).toContain(
      'ɵsxString(ɵsxReadLocal(context, "$count"))',
    );
  });

  it('resolves every marker before replacing any of them', () => {
    const result = transformAngularComponentTemplate(
      `@if (model.ready) { <p>a</p> } @if (model.message) { <p>b</p> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    const marker0 = result.setup.indexOf('const marker0');
    const marker1 = result.setup.indexOf('const marker1');
    const anchor0 = result.setup.indexOf('const anchor0');

    expect(marker0).toBeGreaterThan(-1);
    expect(marker1).toBeGreaterThan(-1);
    // Replacing a marker removes an element, so all paths must be resolved
    // before the first replacement happens.
    expect(marker1).toBeLessThan(anchor0);
    expect(result.setup).toContain('ɵsxRestoreBlockMarker(anchor0, marker0)');
  });

  it('rejects the removed Streamix structural directive', () => {
    expect(() => transformAngularComponentTemplate(
      '<span *sx="count as value">{{ value }}</span>',
    )).toThrowError(/legacy Streamix structural directive/i);
  });
});
