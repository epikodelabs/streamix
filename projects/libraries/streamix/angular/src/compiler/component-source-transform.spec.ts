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
      },
    );

    expect(result.changed).toBeTrue();
    expect(result.source).toContain(
      "import { ɵinstallSxCompiledView } from \"@epikodelabs/streamix/angular\";",
    );
    expect(result.source).toContain(
      "import { ɵsetupSxBindings } from \"./counter.component.ts.sx\";",
    );
    expect(result.source).toContain(
      'private readonly ɵsx = ɵinstallSxCompiledView(',
    );
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
