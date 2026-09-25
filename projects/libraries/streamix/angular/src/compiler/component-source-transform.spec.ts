import {
  installSxLifecycleIntoComponentSource,
} from './component-source-transform';

describe('installSxLifecycleIntoComponentSource', () => {
  it('injects generated imports and component lifecycle installation', () => {
    const result = installSxLifecycleIntoComponentSource(
      `
import { Component } from '@angular/core';

@Component({
  templateUrl: './counter.component.html',
})
export class CounterComponent {
  readonly count = count;
}
      `.trim(),
      {
        setupImportPath: './counter.component.ts.sx',
        sourceReferenceFields: ['count'],
      },
    );

    expect(result.changed).toBeTrue();
    expect(result.source).toContain(
      "import { ɵinstallSxCompiledView, ɵinstallSxSourceReferences } from \"@epikodelabs/streamix/angular\";",
    );
    expect(result.source).toContain(
      "import { ɵsetupSxBindings } from \"./counter.component.ts.sx\";",
    );
    expect(result.source).toContain(
      'protected readonly ɵsx = ɵinstallSxCompiledView(',
    );
    expect(result.source).toContain(
      'ɵinstallSxSourceReferences(',
    );
    expect(result.source).toContain(
      '["count"]',
    );
    expect(result.source).toContain(
      'sourceReferences: this.__sxRefs',
    );
    expect(result.source.indexOf('readonly count = count;')).toBeLessThan(
      result.source.indexOf('public readonly __sxRefs'),
    );
  });

  it('can install only structural source-reference support without a generated setup module', () => {
    const result = installSxLifecycleIntoComponentSource(
      `export class HostComponent { source = first; }`,
      {
        sourceReferenceFields: ['source'],
      },
    );

    expect(result.changed).toBeTrue();
    expect(result.source).toContain(
      "import { ɵinstallSxSourceReferences } from \"@epikodelabs/streamix/angular\";",
    );
    expect(result.source).not.toContain('ɵinstallSxCompiledView');
    expect(result.source).toContain('public readonly __sxRefs');
  });

  it('emits the hybrid Angular invalidation opt-in only when requested', () => {
    const result = installSxLifecycleIntoComponentSource(
      `export class CounterComponent { count = source; }`,
      {
        setupImportPath: './counter.component.ts.sx',
        sourceReferenceFields: ['count'],
        requiresAngularInvalidation: true,
      },
    );

    expect(result.source).toContain('angularInvalidation: true');
  });


  it('rejects an authored member that collides with the generated template bridge', () => {
    expect(() =>
      installSxLifecycleIntoComponentSource(
        `export class HostComponent {
  source = first;
  __sxRefs = 'authored';
}`,
        {
          sourceReferenceFields: ['source'],
        },
      ),
    ).toThrowError(/__sxRefs.*reserved/i);
  });

  it('fails loudly for unsupported source shapes', () => {
    expect(() =>
      installSxLifecycleIntoComponentSource(
        'const CounterComponent = class {};',
        {
          setupImportPath: './counter.component.sx',
        },
      ),
    ).toThrowError(/no conventional exported component class/i);
  });
});
