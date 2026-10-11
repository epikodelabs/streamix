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
      'ɵsxReadLocal(currentContext, "hero.name")',
    );
    expect(result.bindingCount).toBe(1);
  });

  it('supports several top-level nodes as one DOM range', () => {
    const result = compileSxBlockTemplate(
      '<span>{{ item }}</span><button>Open</button>',
    );

    expect(result.rootNodes.length).toBe(2);
  });

  it('chains multi-root bodies inside a fragment so the runtime can move them', () => {
    // The structural runtime walks first.nextSibling up to last when it moves
    // an instance after its anchor. Roots that were created but never chained
    // made every multi-root body throw "Invalid sx structural DOM range" the
    // first time its block rendered.
    const result = compileSxBlockTemplate(
      '<span>{{ item }}</span><button>Open</button>',
    );

    expect(result.createBody).toContain('createDocumentFragment()');
    for (const root of result.rootNodes) {
      expect(result.createBody).toContain(`appendChild(${root});`);
    }
  });

  it('keeps single-root bodies free of a wrapping fragment', () => {
    const result = compileSxBlockTemplate('<li>{{ item.name }}</li>');

    expect(result.rootNodes.length).toBe(1);
    expect(result.createBody).not.toContain('createDocumentFragment()');
  });

  it('fails loudly for inner Angular property bindings', () => {
    expect(() =>
      compileSxBlockTemplate(
        '<button [disabled]="disabled">Save</button>',
      ),
    ).toThrowError(/not yet supported/i);
  });
});
