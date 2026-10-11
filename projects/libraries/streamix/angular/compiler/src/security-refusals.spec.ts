import {
  transformAngularComponentTemplate,
} from './build-transform';

/**
 * Auto-lowering must never take ownership of a binding whose value normally
 * passes through Angular's sanitizer. The compiler refuses the reactive read
 * instead of rendering it once and never updating it.
 */
describe('security-sensitive binding refusals', () => {
  const resolveReactiveSource = (path: string) => ({
    url: 'url',
    image: 'image',
    html: 'html',
    doc: 'doc',
    background: 'background',
    label: 'label',
  } as Record<string, string>)[path];

  const sinks = [
    '[href]="url"',
    '[src]="image"',
    '[innerHTML]="html"',
    '[srcdoc]="doc"',
    '[attr.href]="url"',
    '[style.background-image]="background"',
    '[style.background]="background"',
  ];

  for (const sink of sinks) {
    it(`refuses a source-transparent read in ${sink}`, () => {
      expect(() => transformAngularComponentTemplate(
        `<div ${sink}></div>`,
        'inline.html',
        { resolveReactiveSource },
      )).toThrowError(/cannot bind/);
    });
  }

  it('rejects a reactive read after a nested call in an Angular-owned block header', () => {
    // The header scan must run to the balancing parenthesis: stopping at the
    // first `)` truncates `match(value` and the `model.count` read after the
    // call would be left Angular-owned, rendering once and never updating.
    // The body is deliberately static so the header read is the only one.
    const resolveReactiveSource = (path: string) =>
      ({ 'model.count': 'model.get("count")' })[path];

    expect(() => transformAngularComponentTemplate(
      '@if (match(value) && model.count > 0) { <p>static body</p> }',
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/"model.count".*Angular evaluates this/);
  });

  it('leaves the explicit .value form to Angular sanitization', () => {
    const template = '<a [href]="url.value">link</a>';
    const result = transformAngularComponentTemplate(
      template,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe(template);
    expect(result.setup).not.toContain('ɵsxProperty');
  });

  it('still lowers the allow-listed bindings', () => {
    const result = transformAngularComponentTemplate(
      '<div [attr.aria-label]="label" [attr.data-role]="label" [title]="label" [style.opacity]="label"></div>',
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toContain('[attr.aria-label]="label.value"');
    expect(result.setup).toContain('ɵsxAttribute');
    expect(result.setup).toContain('ɵsxProperty');
    expect(result.setup).toContain('ɵsxStyle');
  });

  it('refuses plain state in a sanitizer sink without erroring', () => {
    const template = '<a [href]="plainUrl">link</a>';
    const result = transformAngularComponentTemplate(
      template,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(result.template).toBe(template);
    expect(result.setup).not.toContain('ɵsxProperty');
  });
});
