import {
  parseSxTemplate,
} from './angular-template-parser';

describe('parseSxTemplate static topology', () => {
  const resolveReactiveSource = (path: string) => ({
    'model.msg': 'model.refs.msg',
    'model.ready': 'model.refs.ready',
  } as Record<string, string>)[path];

  it('rejects compiled bindings on siblings after a structural block', () => {
    // The rendered block content shifts element indices, so a static path
    // computed for the second <p> would target the wrong DOM node.
    expect(() => parseSxTemplate(
      `<section>
        <p [title]="model.msg">a</p>
        @if (model.ready) { <b>b</b> }
        <p [title]="model.msg">c</p>
      </section>`,
      'inline.html',
      { resolveReactiveSource },
    )).toThrowError(/static element topology/i);
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
});
