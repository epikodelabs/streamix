import {
  installSxLifecycleIntoComponentSource,
} from './component-source-transform';

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
});
