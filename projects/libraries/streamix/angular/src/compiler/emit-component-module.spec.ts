import {
  parseSxTemplate,
} from './angular-template-parser';
import {
  emitComponentModule,
  emitLifecycleInitializer,
  emitSourceReferenceInitializer,
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

  it('emits source-reference observation and optional Angular invalidation metadata', () => {
    const code = emitLifecycleInitializer(
      'ɵsetupSxBindings',
      {
        sourceReferences: ['count', 'busy'],
        angularInvalidation: true,
      },
    );

    expect(code).toContain(
      'ɵinstallSxSourceReferences(',
    );
    expect(code).toContain('[\"count\",\"busy\"]');
    expect(code).toContain('sourceReferences: this.__sxRefs');
    expect(code).toContain('angularInvalidation: true');
  });

  it('emits a standalone source-reference registry for structural-only components', () => {
    const code = emitSourceReferenceInitializer(['source']);

    expect(code).toContain('public readonly __sxRefs');
    expect(code).toContain('ɵinstallSxSourceReferences');
    expect(code).toContain('[\"source\"]');
  });
});
