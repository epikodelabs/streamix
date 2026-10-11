import {
  buildDelegateOptions,
  installTransformedTemplate,
  resolveSourceRoot,
  shouldRegenerateOn,
  templateLiteral,
  virtualRootOf,
  virtualTsconfigOf,
} from './options';

describe('streamix builder options', () => {
  it('resolves the source root with the demo default', () => {
    expect(resolveSourceRoot({})).toBe('projects/apps/app6/src');
    expect(resolveSourceRoot({ sourceRoot: 'projects/apps/demo/src' }))
      .toBe('projects/apps/demo/src');
    expect(resolveSourceRoot(undefined)).toBe('projects/apps/app6/src');
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
});
