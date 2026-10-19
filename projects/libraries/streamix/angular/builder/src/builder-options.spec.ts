import {
  buildDelegateOptions,
  installTransformedTemplate,
  resolveSourceRoot,
  shouldRegenerateOn,
  shouldWatchSources,
  templateLiteral,
  virtualRootOf,
  virtualTsconfigOf,
  findSxComponentTemplate,
  installSxComponentTemplate,
} from './options';

describe('streamix builder options', () => {
  it('requires an explicit workspace-relative source root', () => {
    expect(resolveSourceRoot({ sourceRoot: 'projects/apps/demo/src' }))
      .toBe('projects/apps/demo/src');
    expect(() => resolveSourceRoot({})).toThrowError(/requires a non-empty sourceRoot/);
    expect(() => resolveSourceRoot(undefined)).toThrowError(/requires a non-empty sourceRoot/);
    expect(() => resolveSourceRoot({ sourceRoot: '../other' })).toThrowError(/workspace-relative/);
    expect(() => resolveSourceRoot({ sourceRoot: '/tmp/demo' })).toThrowError(/workspace-relative/);
    expect(() => resolveSourceRoot({ sourceRoot: '.' })).toThrowError(/workspace-relative/);
    expect(() => resolveSourceRoot({ sourceRoot: '.angular' })).toThrowError(/workspace-relative/);
  });

  it('forwards only real delegate options', () => {
    expect(buildDelegateOptions({
      delegateTarget: 'app6:application',
      sourceRoot: 'projects/apps/app6/src',
      watch: true,
      optimization: false,
      port: undefined,
      host: null,
      allowedHosts: [],
      headers: {},
    })).toEqual({ watch: true, optimization: false });
  });

  it('schedules regeneration for any watcher event without a configured file', () => {
    expect(shouldRegenerateOn(null, '')).toBeTrue();
    expect(shouldRegenerateOn('page.ts', '')).toBeTrue();
    expect(shouldRegenerateOn('app\\page.ts', '')).toBeTrue();
    expect(shouldRegenerateOn('app/page.ts', '')).toBeTrue();
  });

  it('matches a configured file by basename across separators', () => {
    expect(shouldRegenerateOn('app\\page.ts', 'page.ts')).toBeTrue();
    expect(shouldRegenerateOn('app/page.ts', 'page.ts')).toBeTrue();
    expect(shouldRegenerateOn('page.ts', 'page.ts')).toBeTrue();
    expect(shouldRegenerateOn('app\\other.ts', 'page.ts')).toBeFalse();
  });

  it('watches serve and dev-server but not one-shot build targets', () => {
    expect(shouldWatchSources('application', 'build', undefined)).toBeFalse();
    expect(shouldWatchSources('application', 'build', true)).toBeTrue();
    expect(shouldWatchSources('dev-server', undefined, undefined)).toBeTrue();
    expect(shouldWatchSources('application', 'serve', undefined)).toBeTrue();
  });

  it('maps application source roots to virtual project roots', () => {
    expect(virtualRootOf('projects/apps/app6/src')).toBe('.angular/.streamix/app6/src');
    expect(virtualRootOf('projects/apps/demo/src')).toBe('.angular/.streamix/demo/src');
    expect(virtualTsconfigOf('projects/apps/app6/src')).toBe('.angular/.streamix/app6/tsconfig.app.json');
  });


  it('serializes generated templates as readable backtick literals', () => {
    expect(templateLiteral('<p>{{ a }}</p>')).toBe('`<p>{{ a }}</p>`');
    expect(templateLiteral('say `hi`')).toBe('`say \\`hi\\``');
    expect(templateLiteral('cost: ${x}')).toBe('`cost: \\${x}`');
    expect(templateLiteral('c:\\path')).toBe('`c:\\\\path`');
  });

  it('installs the transformed template into a reprinted CRLF source', () => {
    // The lifecycle install reprints the component with LF endings; the raw
    // source uses CRLF. The old source-anchored replacement silently no-op'd
    // on this exact shape, leaving Angular's own control flow in the virtual
    // template while the compiled setup walked marker paths that do not exist.
    const crlfSource = [
      '@Component({',
      '  template: `',
      '    <p>{{ model.label }}</p>',
      '    @if (model.ready) {',
      '      <span>ready</span>',
      '    }',
      '  `,',
      '  styles: [`:host { display: block; }`],',
      '})',
      'class Fixture {}',
    ].join('\r\n');
    const reprinted = crlfSource
      .replace(/\r\n/g, '\n')
      .replace('class Fixture', 'class ReprintedFixture');
    const transformed = crlfSource.replace(
      /@if \(model\.ready\) \{[\s\S]*?\}/,
      '<span data-sx-block="0"></span>',
    );

    const installed = installTransformedTemplate(reprinted, transformed);

    expect(installed).toContain('data-sx-block="0"');
    expect(installed).not.toContain('@if (model.ready)');
    expect(installed).toContain('class ReprintedFixture');
  });

  it('refuses to install when the reprinted source lost its inline template', () => {
    expect(() => installTransformedTemplate('export class Fixture {}', '<p></p>'))
      .toThrowError(/no longer contains an inline template/);
  });

  it('keeps `$` sequences in the transformed template literal intact', () => {
    const installed = installTransformedTemplate(
      'template: `<p>old</p>`,\n  styles: [`x`]',
      '<p>${spring} $& $1</p>',
    );

    expect(installed).toContain('`<p>\\${spring} $& $1</p>`');
  });
  it('supports inline templates with no styles or with styleUrls', () => {
    const plain = '@Component({ template: `<p>old</p>` }) export class Test {}';
    expect(installTransformedTemplate(plain, '<p>new</p>'))
      .toContain('template: `<p>new</p>`');
    const external = '@Component({ template: `<p>old</p>`, styleUrls: ["style.css"] }) export class Test {}';
    const updated = installTransformedTemplate(external, '<p>new</p>');
    expect(updated).toContain('styleUrls: ["style.css"]');
    expect(updated).toContain('template: `<p>new</p>`');
  });

  it('handles escaped backticks and metadata following a template', () => {
    const original = '@Component({ template: `<p>\\` old</p>`, changeDetection: 0 }) export class Test {}';
    const updated = installTransformedTemplate(original, '<p>replacement</p>');
    expect(updated).toContain('template: `<p>replacement</p>`');
    expect(updated).toContain('changeDetection: 0');
  });

  it('reads external component templates and installs compiled content in the virtual source', () => {
    const input = '@Component({ selector: "demo", templateUrl: "./counter.html", styleUrls: ["./counter.css"] }) export class Counter {}';
    const found = findSxComponentTemplate(input);
    expect(found?.kind).toBe('external');
    if (!found || found.kind !== 'external') return;
    expect(found.url).toBe('./counter.html');
    const output = installSxComponentTemplate(input, '<output>{{ count.value }}</output>');
    expect(output).toContain('template: `<output>{{ count.value }}</output>`');
    expect(output).not.toContain('templateUrl');
    expect(output).toContain('styleUrls: ["./counter.css"]');
  });

});


describe('introspection builder configuration', () => {
  it('consumes introspection and enables the shared development gate for the delegate', () => {
    expect(buildDelegateOptions({ introspection: true, define: { VERSION: '\"test\"' } }))
      .toEqual({ define: { VERSION: '\"test\"', 'import.meta.env.DEV': 'true' } });
    expect(buildDelegateOptions({ introspection: false })).toEqual({});
    expect(buildDelegateOptions({})).toEqual({});
  });
});
