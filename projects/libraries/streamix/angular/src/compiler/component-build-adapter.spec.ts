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
    expect(result.transformedTemplate).toContain('[disabled]="busy.value"');
    expect(result.transformedTemplate).toContain('{{ count.value }}');
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
    expect(result.transformedTemplate).toContain('[disabled]="scoped.refs.busy.value"');
    expect(result.transformedTemplate).toContain('{{ scoped.refs.count.value * 2 }}');
    expect(result.generatedModule?.contents).toContain('ctx.scoped.refs.busy');
    expect(result.generatedModule?.contents).toContain('[ctx.scoped.refs.count]');
  });
});
