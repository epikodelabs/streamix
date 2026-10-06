import {
  buildDelegateOptions,
  resolveSourceRoot,
  shouldRegenerateOn,
  sourceTwinOf,
  templateLiteral,
  virtualRootOf,
} from './options.mjs';

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
    expect(virtualRootOf('projects/apps/app6/src')).toBe('.angular/streamix/app6/src');
    expect(virtualRootOf('projects/apps/demo/src')).toBe('.angular/streamix/demo/src');
  });

  it('maps generated module entries to their source twin', () => {
    expect(sourceTwinOf('app/app.component.sx.ts')).toBe('app/app.component.ts');
    expect(sourceTwinOf('app/app.component.ts')).toBe('app/app.component.ts');
  });

  it('serializes generated templates as readable backtick literals', () => {
    expect(templateLiteral('<p>{{ a }}</p>')).toBe('`<p>{{ a }}</p>`');
    expect(templateLiteral('say `hi`')).toBe('`say \\`hi\\``');
    expect(templateLiteral('cost: ${x}')).toBe('`cost: \\${x}`');
    expect(templateLiteral('c:\\path')).toBe('`c:\\\\path`');
  });
});
