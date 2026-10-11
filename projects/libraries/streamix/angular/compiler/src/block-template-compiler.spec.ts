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

  it('leaves @let names inside string literals untouched', () => {
    // The substitution rewrote every occurrence of the name, including the
    // one inside the string literal, silently changing the compiled value.
    const result = compileSxBlockTemplate(
      `@let tag = model.tag;
       <button (click)="tagged('tag')">go</button>`,
      'sx-block.html',
      {
        resolveReactiveSource: (path: string) =>
          ({ 'model.tag': 'model.get("tag")' })[path],
      },
    );

    expect(
      result.bindings[0] && result.bindings[0].kind === 'event'
        ? result.bindings[0].handler
        : '',
    ).toBe(`ctx.tagged('tag')`);
  });

  it('compiles safe property, class, style and attribute bindings in a collection body', () => {
    const result = compileSxBlockTemplate(
      '<li [class.active]="row.active" [title]="row.name" [style.width]="row.width" data-label="{{ row.name }}">{{ row.name }}</li>',
      'fixture.html', { allowLocals: true },
    );
    expect(result.updateBody).toContain('classList.toggle("active"');
    expect(result.updateBody).toContain('["title"]');
    expect(result.updateBody).toContain('.style.setProperty("width"');
    expect(result.updateBody).toContain('setAttribute("data-label"');
  });

  it('binds reactive sources inside @if bodies through the same binding table writers', () => {
    const result = compileSxBlockTemplate(
      '<button [disabled]="model.disabled" [class.active]="model.active">Save</button>',
      'fixture.html', {
        resolveReactiveSource: path => ({
          'model.disabled': 'model.get("disabled")',
          'model.active': 'model.get("active")',
        } as Record<string, string>)[path],
      },
    );
    expect(result.bindings.map(binding => binding.kind)).toEqual(['property', 'class']);
  });

  it('rejects unsafe sanitizer-sensitive sinks inside compiled blocks', () => {
    expect(() => compileSxBlockTemplate(
      '<a [href]="row.url">bad</a>', 'fixture.html', { allowLocals: true },
    )).toThrowError(/sanitizer-sensitive/);
  });

});
