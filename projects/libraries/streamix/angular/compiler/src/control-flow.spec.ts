import {
  transformAngularComponentTemplate,
} from './build-transform';

describe('standard Angular atom templates', () => {
  const resolveReactiveSource = (path: string) => ({
    count: 'count',
    total: 'total',
    items: 'items',
    more: 'more',
    'model.ready': "model.get('ready')",
    'model.message': "model.get('message')",
    'model.items': "model.get('items')",
    'model.status': "model.get('status')",
    'model.total': "model.get('total')",
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
      "ɵsxText(blockTable, 0, text1, ctx.model.get('message'))",
    );
    expect(result.sourceReferenceFields).toContain('model');
  });

  it('lowers classic *ngIf and *ngFor on a single element', () => {
    const result = transformAngularComponentTemplate(`
      <p *ngIf="model.ready">{{ model.message }}</p>
      <li *ngFor="let item of model.items; trackBy: trackRow">{{ item.name }}</li>
    `, 'inline.html', { resolveReactiveSource });

    expect(result.template).toBe(
      '\n      <span data-sx-block="0"></span>\n      <span data-sx-block="1"></span>\n    ',
    );
    expect(result.setup).toContain('ɵcreateSxConditionalBlock');
    expect(result.setup).toContain('ɵcreateSxKeyedBlock');
    expect(result.setup).toContain("ctx.model.get('ready')");
    expect(result.setup).toContain("ctx.model.get('items')");
    expect(result.setup).toContain('ctx.trackRow(_index, item)');
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
    )).toThrowError(/cannot bind/);
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
      "ɵsxText(blockTable, 0, text1, ctx.model.get('message'))",
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
    expect(result.setup).toContain('(_index: any, item: any) => item.id');
    expect(result.setup).toContain(
      'ɵsxString(ɵsxReadLocal(currentContext, "item.name"))',
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
      'ɵsxString(ɵsxReadLocal(currentContext, "$count"))',
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

  it('compiles a compound @if condition over one source', () => {
    const result = transformAngularComponentTemplate(
      `@if (count > 3) { <p>big</p> } @else { <p>small</p> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('source: { sources: [ctx.count]');
    expect(result.setup).toContain('read: () => ctx.count.value > 3');
    expect(result.setup).toContain('source: null');
  });

  it('compiles an @else if chain over several sources', () => {
    const result = transformAngularComponentTemplate(
      `@if (count > total) { <p>a</p> } @else if (count + total > 10) { <p>b</p> } @else { <p>c</p> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain('source: { sources: [ctx.count, ctx.total]');
    expect(result.setup).toContain(
      'read: () => ctx.count.value + ctx.total.value > 10',
    );
  });

  it('compiles a @switch over an expression with literal cases', () => {
    const result = transformAngularComponentTemplate(
      `@switch (count + total) { @case (5) { <p>five</p> } @default { <p>other</p> } }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain('sources: [ctx.count, ctx.total]');
    expect(result.setup).toContain('match: 5');
  });

  it('compiles a @for collection expression over several sources', () => {
    const result = transformAngularComponentTemplate(
      `@for (row of items.concat(more); track row.id) { <li>{{ row.name }}</li> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('sources: [ctx.items, ctx.more]');
    expect(result.setup).toContain(
      'read: () => ctx.items.value.concat(ctx.more.value)',
    );
  });

  it('compiles a compound native class binding', () => {
    const result = transformAngularComponentTemplate(
      '<span [class.active]="count > 3"></span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toContain('[class.active]="count.value > 3"');
    expect(result.setup).toContain(
      'ɵsxClassExpression(table, 0, node0, "active", [ctx.count], () => ctx.count.value > 3)',
    );
  });

  it('compiles a compound native attribute binding', () => {
    const result = transformAngularComponentTemplate(
      '<span [attr.aria-label]="count + total"></span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toContain(
      '[attr.aria-label]="count.value + total.value"',
    );
    expect(result.setup).toContain('ɵsxAttributeExpression');
  });

  it('compiles a compound scope expression through the accessor form', () => {
    const result = transformAngularComponentTemplate(
      '<span>{{ model.total * 2 }}</span>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain(
      'ɵsxTextExpressionNode(table, 0, node0, [ctx.model.get(\'total\')], () => ctx.model.get(\'total\').value * 2)',
    );
  });

  it('compiles a compound expression inside a block body', () => {
    const result = transformAngularComponentTemplate(
      `@if (model.ready) { <p>{{ model.total * 2 }}</p> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain(
      "ɵsxTextExpression(blockTable, 0, text1, [ctx.model.get('total')], () => ctx.model.get('total').value * 2)",
    );
  });

  it('compiles a nested @if over a loop local inside @for', () => {
    const result = transformAngularComponentTemplate(
      `@for (row of model.items; track row.id) { <li>@if (row.done) { <s>{{ row.name }}</s> }</li> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain('doc.createComment("sx")');
    expect(result.setup).toContain('ɵcreateSxConditionalBlock(anchor1, [');
    expect(result.setup).toContain(
      'read: () => ɵsxReadLocal(currentContext, "row.done")',
    );
    // The enclosing update re-evaluates the nested condition per item.
    expect(result.setup).toMatch(/block\d+\.refresh\(\);/);
  });

  it('compiles a nested @if over reactive sources inside a conditional body', () => {
    const result = transformAngularComponentTemplate(
      `@if (model.ready) { @if (count > 3) { <p>big</p> } }`,
      'inline.html',
      { resolveReactiveSource },
    );

    // The outer block and the nested one both compile to the runtime.
    expect(
      result.setup.match(/ɵcreateSxConditionalBlock\(/g)?.length,
    ).toBe(2);
    expect(result.setup).toContain('sources: [ctx.count]');
    expect(result.setup).toContain('read: () => ctx.count.value > 3');
  });

  it('inlines @let declarations into the expressions that read them', () => {
    const result = transformAngularComponentTemplate(
      `@for (row of model.items; track row.id) { @let total = row.price * 2; <p>{{ total }}</p> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe('<span data-sx-block="0"></span>');
    expect(result.setup).toContain(
      'ɵsxString((ɵsxReadLocal(currentContext, "row.price") * 2))',
    );
  });

  it('compiles a nested @for over a loop-local collection', () => {
    const result = transformAngularComponentTemplate(
      `@for (group of model.items; track group.id) { <ul>@for (tag of group.tags; track tag) { <li>{{ tag }}</li> }</ul> }`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.setup).toContain('ɵcreateSxKeyedBlock(');
    expect(result.setup).toContain(
      'read: () => ɵsxReadLocal(currentContext, "group.tags")',
    );
    // The nested context extends the enclosing one, so outer locals stay visible.
    expect(result.setup).toContain('let currentContext = { ...currentContext,');
  });
});
