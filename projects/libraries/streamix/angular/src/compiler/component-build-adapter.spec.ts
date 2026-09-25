import {
  compileSxComponent,
} from './component-build-adapter';

describe('compileSxComponent', () => {
  it('returns marker-free generated direct-node setup', () => {
    const result = compileSxComponent({
      componentPath: 'src/app/counter.component.ts',
      template: `
        <span [sx.text]="count"></span>
        <button [sx.disabled]="disabled">Save</button>
      `,
    });

    expect(result.bindingCount).toBe(2);
    expect(result.sourceReferenceFields).toEqual(['count', 'disabled']);
    expect(result.lifecycleInitializer).toContain('[\"count\",\"disabled\"]');
    expect(result.requiresAngularInvalidation).toBeFalse();
    expect(result.lifecycleInitializer).toContain(
      'sourceReferences: this.__sxRefs',
    );
    expect(result.transformedTemplate).not.toContain('[sx.text]');
    expect(result.transformedTemplate).toContain('[textContent]="count.value"');
    expect(result.transformedTemplate).toContain('[disabled]="disabled.value"');
    expect(result.transformedTemplate).not.toContain('data-sx');
    expect(result.generatedModule?.contents).not.toContain('querySelector');
    expect(result.generatedModule?.contents).toContain('host.children[0]');
    expect(result.generatedModule?.contents).toContain('host.children[1]');
  });

  it('accepts DependencySource paths discovered by the TypeScript-aware adapter', () => {
    const result = compileSxComponent({
      componentPath: 'src/app/counter.component.ts',
      template: '<button [disabled]="busy">{{ count }}</button>',
      dependencySourcePaths: ['busy', 'count'],
    });

    expect(result.bindingCount).toBe(2);
    expect(result.sourceReferenceFields).toEqual(['busy', 'count']);
    expect(result.lifecycleInitializer).toContain('[\"busy\",\"count\"]');
    expect(result.lifecycleInitializer).toContain(
      'sourceReferences: this.__sxRefs',
    );
    expect(result.transformedTemplate).toContain('[disabled]="busy.value"');
    expect(result.transformedTemplate).toContain('{{ count.value }}');
  });
  it('links simple structural sx sources to compiler-owned source-reference cells', () => {
    const result = compileSxComponent({
      componentPath: 'src/app/host.component.ts',
      template: '<span *sx="source as value">{{ value }}</span>',
    });

    expect(result.bindingCount).toBe(0);
    expect(result.generatedModule).toBeUndefined();
    expect(result.sourceReferenceFields).toEqual(['source']);
    expect(result.transformedTemplate).toContain(
      '*sx="source as value; sourceRef: __sxRefs.source"',
    );
    expect(result.lifecycleInitializer).toContain('public readonly __sxRefs');
    expect(result.lifecycleInitializer).not.toContain('ɵinstallSxCompiledView');
  });

  it('opts into Angular invalidation only for hybrid expressions', () => {
    const result = compileSxComponent({
      componentPath: 'src/app/counter.component.ts',
      template: '<span>{{ count.value * multiplier }}</span>',
    });

    expect(result.sourceReferenceFields).toEqual(['count']);
    expect(result.requiresAngularInvalidation).toBeTrue();
    expect(result.lifecycleInitializer).toContain(
      'angularInvalidation: true',
    );
  });
});

describe('scope value metadata', () => {
  it('accepts value-first Scope member metadata and binds through refs', () => {
    const result = compileSxComponent({
      componentPath: 'src/app/counter.component.ts',
      template: '<button [disabled]="scoped.busy">{{ scoped.count * 2 }}</button>',
      scopeValuePaths: {
        scoped: ['busy', 'count'],
      },
    });

    expect(result.bindingCount).toBe(2);
    expect(result.sourceReferenceFields).toEqual(['scoped']);
    expect(result.lifecycleInitializer).toContain('[\"scoped\"]');
    expect(result.lifecycleInitializer).toContain(
      'sourceReferences: this.__sxRefs',
    );
    expect(result.transformedTemplate).toContain('[disabled]="scoped.refs.busy.value"');
    expect(result.transformedTemplate).toContain('{{ scoped.refs.count.value * 2 }}');
    expect(result.generatedModule?.contents).toContain('ctx.scoped.refs.busy');
    expect(result.generatedModule?.contents).toContain('[ctx.scoped.refs.count]');
  });
});
