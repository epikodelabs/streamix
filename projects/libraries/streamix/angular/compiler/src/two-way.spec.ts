import {
  transformAngularComponentTemplate,
} from './build-transform';
import {
  createScopeValuePathResolver,
  createScopeWritableResolver,
  createWritableSourcePathResolver,
} from './source-resolution';

describe('two-way bindings', () => {
  const resolveReactiveSource = (path: string) => ({
    count: 'count',
    'model.name': "model.get('name')",
    'model.done': "model.get('done')",
    'model.label': "model.get('label')",
  } as Record<string, string>)[path];
  const resolveReactiveWritable = createWritableSourcePathResolver(['count']);
  const rewriteWritable = createScopeWritableResolver({
    model: ['name', 'done'],
  });

  const options = {
    resolveReactiveSource,
    resolveReactiveWritable: (path: string) =>
      resolveReactiveWritable(path) ?? rewriteWritable(path),
  };

  it('lowers a writable atom two-way binding to a property plus a listener', () => {
    const result = transformAngularComponentTemplate(
      '<input [(value)]="count">',
      'inline.html',
      options,
    );

    // Angular renders the server/hydration value; the compiled pair owns the DOM.
    expect(result.template).toContain('[value]="($any(count.value) !== __sxNoInitialValue) ? (count.value) : undefined"');
    expect(result.template).not.toContain('valueChange');
    expect(result.setup).toContain(
      'ɵsxProperty(table, 0, node0, "value", ctx.count);',
    );
    expect(result.setup).toContain(
      'ɵsxListener(table, 1, node0, "input", (event) => { ctx.count.set(event.target.value); }, undefined, server);',
    );
  });

  it('lowers a scope member two-way binding through its accessor', () => {
    const result = transformAngularComponentTemplate(
      '<input [(checked)]="model.done">',
      'inline.html',
      options,
    );

    expect(result.template).toContain("[checked]=\"($any(model.get('done').value) !== __sxNoInitialValue) ? (model.get('done').value) : undefined\"");
    expect(result.setup).toContain(
      "ɵsxListener(table, 1, node0, \"change\", (event) => { ctx.model.set('done', event.target.checked); }, undefined, server);",
    );
  });

  it('lowers a nested scope member two-way binding through each scope', () => {
    const result = transformAngularComponentTemplate(
      '<input [(value)]="model.user.name">',
      'inline.html',
      {
        resolveReactiveSource: createScopeValuePathResolver({ model: ['user.name'] }),
        resolveReactiveWritable: createScopeWritableResolver({ model: ['user.name'] }),
      },
    );

    expect(result.template).toContain(
      "[value]=\"($any(model.get('user').get('name').value) !== __sxNoInitialValue) ? (model.get('user').get('name').value) : undefined\"",
    );
    expect(result.setup).toContain(
      "ɵsxListener(table, 1, node0, \"input\", (event) => { ctx.model.get('user').set('name', event.target.value); }, undefined, server);",
    );
  });

  it('rejects a two-way binding over a derived or unknown source', () => {
    expect(() => transformAngularComponentTemplate(
      '<input [(value)]="model.label">',
      'inline.html',
      options,
    )).toThrowError(/two-way binding is only supported/i);
  });

  it('rejects a two-way binding over a security-sensitive property', () => {
    expect(() => transformAngularComponentTemplate(
      '<div [(innerHTML)]="count"></div>',
      'inline.html',
      options,
    )).toThrowError(/two-way binding is only supported/i);
  });

  it('rejects a two-way binding on a component element', () => {
    expect(() => transformAngularComponentTemplate(
      '<app-field [(value)]="count"></app-field>',
      'inline.html',
      options,
    )).toThrowError(/two-way binding is only supported/i);
  });

  it('leaves a two-way binding over plain state to Angular', () => {
    const template = '<input [(value)]="plainField">';
    const result = transformAngularComponentTemplate(
      template,
      'inline.html',
      options,
    );

    expect(result.template).toBe(template);
    expect(result.setup).not.toContain('ɵsxListener');
  });
});
