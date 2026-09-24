import {
  parseSxTemplate,
} from './angular-template-parser';
import {
  emitComponentModule,
  emitLifecycleInitializer,
} from './emit-component-module';

describe('emitComponentModule', () => {
  it('emits a complete setup module', () => {
    const parsed = parseSxTemplate(
      '<button [sx.disabled]="disabled"></button>',
    );

    const code = emitComponentModule(parsed);

    expect(code).toContain(
      "from \"@epikodelabs/streamix/angular\";",
    );
    expect(code).toContain(
      'const table = createBindingTable(1);',
    );
    expect(code).toContain(
      'ɵsxProperty(table, 0, node0, "disabled", ctx.disabled);',
    );
  });

  it('emits the Angular lifecycle initializer', () => {
    expect(emitLifecycleInitializer()).toContain(
      'ɵinstallSxCompiledView',
    );
    expect(emitLifecycleInitializer()).toContain(
      'ɵsetupSxBindings',
    );
  });
});
