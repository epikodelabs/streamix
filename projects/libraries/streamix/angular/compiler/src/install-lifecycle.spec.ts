import {
  installSxLifecycleIntoComponentSource,
} from './install-lifecycle';

describe('installSxLifecycleIntoComponentSource', () => {
  it('inlines generated setup and component lifecycle installation', () => {
    const result = installSxLifecycleIntoComponentSource(
      `
import { Component } from '@angular/core';

@Component({ templateUrl: './counter.component.html' })
export class CounterComponent {
  readonly count = count;
}
      `.trim(),
      {
        inlineSetup: 'function setupBindings() { return createBindingTable(0); }',
        setupName: 'setupBindings',
        sourceReferenceFields: ['count'],
      },
    );

    expect(result.changed).toBeTrue();
    expect(result.source).toContain('createBindingTable');
    expect(result.source).toContain('function setupBindings()');
    expect(result.source).not.toContain('.sx.ts');
    expect(result.source).toContain('protected readonly');
    expect(result.source).toContain('sourceReferences: this.__sxRefs');
    expect(result.source.indexOf('readonly count = count;')).toBeLessThan(
      result.source.indexOf('public readonly __sxRefs'),
    );
  });

  it('can install only structural source-reference support without setup code', () => {
    const result = installSxLifecycleIntoComponentSource(
      `export class HostComponent { source = first; }`,
      { sourceReferenceFields: ['source'] },
    );

    expect(result.changed).toBeTrue();
    expect(result.source).toContain('public readonly __sxRefs');
    expect(result.source).not.toContain('createBindingTable');
  });

  it('rejects an authored member that collides with the generated template bridge', () => {
    expect(() =>
      installSxLifecycleIntoComponentSource(
        `export class HostComponent {
  source = first;
  __sxRefs = 'authored';
}`,
        { sourceReferenceFields: ['source'] },
      ),
    ).toThrowError(/__sxRefs.*reserved/i);
  });

  it('fails loudly for unsupported source shapes', () => {
    expect(() =>
      installSxLifecycleIntoComponentSource(
        'const CounterComponent = class {};',
        { inlineSetup: 'function setupBindings() { return undefined; }' },
      ),
    ).toThrowError(/no conventional exported component class/i);
  });

  it('installs into class shapes the string scanner refused', () => {
    const generics = installSxLifecycleIntoComponentSource(
      `export class HostComponent<T> extends Base<T> implements OnInit {
  source = first;
}`,
      {
        inlineSetup: 'function setupBindings() { return undefined; }',
        setupName: 'setupBindings',
      },
    );

    expect(generics.changed).toBeTrue();
    expect(generics.source).toContain('ngAfterViewInit');

    const defaultExport = installSxLifecycleIntoComponentSource(
      `export default class HostComponent {
  source = first;
}`,
      {
        inlineSetup: 'function setupBindings() { return undefined; }',
        setupName: 'setupBindings',
      },
    );

    expect(defaultExport.changed).toBeTrue();
  });

  it('merges an authored ngAfterViewInit instead of duplicating it', () => {
    const result = installSxLifecycleIntoComponentSource(
      `export class HostComponent {
  ngAfterViewInit(): void {
    this.authored();
  }
}`,
      { inlineSetup: 'function setupBindings() { return undefined; }' },
    );

    expect(result.source).toContain('this.authored()');
    expect(result.source.match(/ngAfterViewInit/g)?.length).toBe(1);
    expect(result.source.indexOf('ɵafterViewInit()')).toBeLessThan(
      result.source.indexOf('this.authored()'),
    );
  });

  it('is idempotent by declaration, not by text', () => {
    const options = {
      inlineSetup: 'function setupBindings() { return undefined; }',
      setupName: 'setupBindings',
    };
    const once = installSxLifecycleIntoComponentSource(
      'export class HostComponent { source = first; }',
      options,
    );
    const twice = installSxLifecycleIntoComponentSource(once.source, options);

    expect(twice.changed).toBeFalse();
  });

  it('installs even when a comment mentions the generated install call', () => {
    // The previous string scanner treated this comment as proof that the
    // component was already installed, silently shipping a component whose
    // compiled markers never mount.
    const result = installSxLifecycleIntoComponentSource(
      `// historically: ɵinstallSxCompiledView( this, ɵsetupSxBindings )
export class HostComponent { source = first; }`,
      {
        inlineSetup: 'function setupBindings() { return undefined; }',
        setupName: 'setupBindings',
      },
    );

    expect(result.changed).toBeTrue();
    expect(result.source).toContain('ɵinstallSxCompiledView');
  });
});
