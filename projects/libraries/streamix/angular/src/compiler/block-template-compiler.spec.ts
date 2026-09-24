import {
  compileSxBlockTemplate,
} from './block-template-compiler';

describe('compileSxBlockTemplate', () => {
  it('emits direct element/text creation with no HTML parser', () => {
    const result = compileSxBlockTemplate(
      '<li class="hero">Hello {{ hero.name }}</li>',
    );

    expect(result.createBody).toContain(
      'document.createElement("li")',
    );
    expect(result.createBody).toContain(
      '.setAttribute("class", "hero")',
    );
    expect(result.createBody).toContain(
      'document.createTextNode("")',
    );
    expect(result.updateBody).toContain(
      'ɵsxReadLocal(context, "hero.name")',
    );
    expect(result.bindingCount).toBe(1);
  });

  it('supports several top-level nodes as one DOM range', () => {
    const result = compileSxBlockTemplate(
      '<span>{{ item }}</span><button>Open</button>',
    );

    expect(result.rootNodes.length).toBe(2);
  });

  it('fails loudly for inner Angular property bindings', () => {
    expect(() =>
      compileSxBlockTemplate(
        '<button [disabled]="disabled">Save</button>',
      ),
    ).toThrowError(/not yet supported/i);
  });
});
