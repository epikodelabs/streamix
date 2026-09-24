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
    expect(result.transformedTemplate).not.toContain('data-sx');
    expect(result.generatedModule?.contents).not.toContain('querySelector');
    expect(result.generatedModule?.contents).toContain('host.children[0]');
    expect(result.generatedModule?.contents).toContain('host.children[1]');
  });
});
