import {
  parseSxTemplate,
} from './angular-template-parser';

describe('parseSxTemplate static topology', () => {
  const resolveReactiveSource = (path: string) => ({
    'model.msg': "model.get('msg')",
    'model.ready': "model.get('ready')",
  } as Record<string, string>)[path];

  it('addresses compiled bindings after Angular-owned structural siblings by stable targets', () => {
    const source = `<section>
      <p [title]="model.msg">a</p>
      @if (model.ready) { <b>b</b> }
      <p [title]="model.msg">c</p>
    </section>`;
    const parsed = parseSxTemplate(source, 'inline.html', { resolveReactiveSource });
    expect(parsed.plan.size).toBe(2);
    expect(parsed.nodeSelectors['node2']).toContain(':scope >');
    expect(parsed.nodeSelectors['node2']).toContain('data-sx-node');
    expect(parsed.bindingEdits.some(edit => edit.replacement.includes('data-sx-node'))).toBeTrue();
  });

  it('allows structural blocks after the last compiled binding', () => {
    const parsed = parseSxTemplate(
      `<section>
        <p [title]="model.msg">a</p>
        @if (model.ready) { <b>b</b> }
      </section>`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(parsed.plan.size).toBe(1);
    expect(parsed.nodePaths['node1']).toEqual([0, 0]);
  });

  it('does not reject blocks merely containing Angular-owned atom reads', () => {
    // Control-flow lowering rewrites block interiors to `.value` fallbacks;
    // those belong to Angular, not the static path compiler.
    const parsed = parseSxTemplate(
      `<section>
        @if (model.ready) { <p>{{ model.msg }}</p> }
      </section>`,
      'inline.html',
      { resolveReactiveSource },
    );

    expect(parsed.nodes).toEqual(['node0']);
  });

  it('rejects compiled bindings in projected content', () => {
    expect(() => parseSxTemplate(
      `<app-card><p>{{ model.msg }}</p></app-card>`,
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/projection|static element topology/i);
  });
});
