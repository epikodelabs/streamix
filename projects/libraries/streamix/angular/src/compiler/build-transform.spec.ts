import {
  transformAngularComponentTemplate,
} from './build-transform';

describe('transformAngularComponentTemplate', () => {
  it('emits direct static-node acquisition for standard Angular bindings', () => {
    const result = transformAngularComponentTemplate(`
      <span>{{ count }}</span>
      <button [disabled]="disabled"></button>
    `, 'inline.html', {
      resolveReactiveSource: path => ['count', 'disabled'].includes(path) ? path : undefined,
    });

    expect(result.bindingCount).toBe(2);
    expect(result.sourceReferenceFields).toEqual(['count', 'disabled']);
    expect(result.requiresAngularInvalidation).toBeFalse();
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


describe('structural source-reference instrumentation', () => {
  it('links a simple scalar sx source to the compiler-owned reference registry', () => {
    const result = transformAngularComponentTemplate(
      '<span *sx="source as value">{{ value }}</span>',
    );

    expect(result.bindingCount).toBe(0);
    expect(result.sourceReferenceFields).toEqual(['source']);
    expect(result.template).toContain(
      '*sx="source as value; sourceRef: __sxRefs[\'source\']"',
    );
  });

  it('links a simple collection source while preserving the rest of microsyntax', () => {
    const result = transformAngularComponentTemplate(
      '<li *sx="let item of items; trackBy: trackItem; let i = index">{{ i }}</li>',
    );

    expect(result.bindingCount).toBe(0);
    expect(result.sourceReferenceFields).toEqual(['items']);
    expect(result.template).toContain(
      'sourceRef: __sxRefs[\'items\']',
    );
    expect(result.template).toContain('trackBy: trackItem');
    expect(result.template).toContain('let i = index');
  });

  it('does not instrument complex structural source expressions without a safe field identity', () => {
    const template = '<span *sx="model.source as value">{{ value }}</span>';
    const result = transformAngularComponentTemplate(template);

    expect(result.sourceReferenceFields).toEqual([]);
    expect(result.template).toBe(template);
  });

  it('rewrites scoped member sources through the resolver-mapped refs path', () => {
    const result = transformAngularComponentTemplate(
      '<span *sx="model.celebration as text">{{ text }}</span>',
      'inline.html',
      {
        resolveReactiveSource: path =>
          path === 'model.celebration' ? 'model.refs.celebration' : undefined,
      },
    );

    expect(result.template).toBe(
      '<span *sx="model.refs.celebration as text">{{ text }}</span>',
    );
    expect(result.sourceReferenceFields).toEqual(['model']);
  });
});

describe('standard Angular control flow', () => {
  it('lowers a scope-valued @if and invalidates Angular-owned block DOM', () => {
    const result = transformAngularComponentTemplate(`
      @if (model.celebration) {
        <strong>{{ model.celebration }}</strong>
      }
    `, 'inline.html', {
      resolveReactiveSource: path =>
        path === 'model.celebration' ? 'model.refs.celebration' : undefined,
    });

    expect(result.bindingCount).toBe(1);
    expect(result.requiresAngularInvalidation).toBeTrue();
    expect(result.sourceReferenceFields).toEqual(['model']);
    expect(result.template).toContain('@if (model.refs.celebration.value)');
    expect(result.template).toContain('{{ model.refs.celebration.value }}');
    expect(result.setup).toContain(
      'ЙµsxInvalidate(table, 0, [ctx.model.refs.celebration], invalidate);',
    );
  });

  it('lowers scoped @for and @switch expressions and invalidates their views', () => {
    const result = transformAngularComponentTemplate(`
      @for (item of model.items; track item.id) { <span>{{ item.name }}</span> }
      @switch (model.status) { @case ('ready') { <span>Ready</span> } }
    `, 'inline.html', {
      resolveReactiveSource: path => ({
        'model.items': 'model.refs.items',
        'model.status': 'model.refs.status',
      } as Record<string, string>)[path],
    });

    expect(result.requiresAngularInvalidation).toBeTrue();
    expect(result.sourceReferenceFields).toEqual(['model']);
    expect(result.template).toContain('@for (item of model.refs.items.value;');
    expect(result.template).toContain('@switch (model.refs.status.value)');
    expect(result.setup).toContain('[ctx.model.refs.items,ctx.model.refs.status]');
  });

  it('lowers scoped classic structural directives', () => {
    const result = transformAngularComponentTemplate(`
      <p *ngIf="model.ready">Ready</p>
      <span *ngFor="let item of model.items">{{ item.name }}</span>
      <div [ngSwitch]="model.status">
        <span *ngSwitchCase="'ready'">Ready</span>
      </div>
    `, 'inline.html', {
      resolveReactiveSource: path => ({
        'model.ready': 'model.refs.ready',
        'model.items': 'model.refs.items',
        'model.status': 'model.refs.status',
      } as Record<string, string>)[path],
    });

    expect(result.requiresAngularInvalidation).toBeTrue();
    expect(result.sourceReferenceFields).toEqual(['model']);
    expect(result.template).toContain('*ngIf="model.refs.ready.value"');
    expect(result.template).toContain('*ngFor="let item of model.refs.items.value"');
    expect(result.template).toContain('[ngSwitch]="model.refs.status.value"');
    expect(result.setup).toContain(
      '[ctx.model.refs.ready,ctx.model.refs.items,ctx.model.refs.status]',
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
    expect(result.sourceReferenceFields).toEqual(['count']);
    expect(result.requiresAngularInvalidation).toBeTrue();
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
    expect(result.sourceReferenceFields).toEqual([
      'count',
      'busy',
      'label',
      'active',
      'opacity',
    ]);
    expect(result.requiresAngularInvalidation).toBeFalse();
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
    expect(result.sourceReferenceFields).toEqual([]);
    expect(result.requiresAngularInvalidation).toBeFalse();
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
