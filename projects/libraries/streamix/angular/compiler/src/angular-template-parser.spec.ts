import {
  parseSxTemplate,
} from './angular-template-parser';
import { transformAngularComponentTemplate } from './build-transform';

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
    expect(parsed.nodeMarkerPaths['node2']).toEqual(['node0', 'node2']);
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

  for (const [host, template] of [
    ['element', '<app-card>@if (model.ready) { <p>yes</p> }</app-card>'],
    ['attribute', '<div appCard><ng-container>@if (model.ready) { <p>yes</p> }</ng-container></div>'],
  ] as const) {
    it(`rejects lowered markers inside a component with an ${host} selector`, () => {
      expect(() => transformAngularComponentTemplate(template, 'inline.html', {
        resolveReactiveSource,
        componentSelectors: ['app-card', 'div[appCard]'],
      })).toThrowError(/static element topology.*projection/i);
    });
  }

  it('keeps lowered markers under a native host with an unrelated attribute', () => {
    const result = transformAngularComponentTemplate(
      '<div other>@if (model.ready) { <p>yes</p> }</div>',
      'inline.html',
      { resolveReactiveSource, componentSelectors: ['div[appCard]'] },
    );
    expect(result.structuralBlockCount).toBe(1);
  });


  it('counts flattened ng-container text when addressing interpolations', () => {
    const parsed = parseSxTemplate(
      '<p><ng-container>prefix </ng-container>{{ count }}</p>',
      'inline.html',
      { resolveReactiveSource: path => path === 'count' ? 'count' : undefined },
    );

    const text = parsed.plan.bindings.find(binding => binding.kind.startsWith('text-') && binding.kind.includes('node'));
    expect(text?.name).toBe('1');
  });

  it('wraps interpolations after lowered dynamic siblings in compiler-owned markers', () => {
    const parsed = parseSxTemplate(
      '<p><span data-sx-block="0"></span>{{ count }}</p>',
      'inline.html',
      { resolveReactiveSource: path => path === 'count' ? 'count' : undefined },
    );

    const edit = parsed.bindingEdits.find(edit =>
      edit.replacement.includes('<span data-sx-node="node'));
    expect(edit).toBeDefined();
    expect(edit!.replacement).toContain('{{ '); expect(edit!.replacement).toContain('</span>');

    const text = parsed.plan.bindings.find(binding => binding.kind.startsWith('text-') && binding.kind.includes('node'));
    expect(text).toBeDefined();
    expect(text!.name).toBeUndefined();
    // The wrapper carries its own stable-target marker and is addressed
    // through a marker path instead of shifting child indices.
    expect(
      parsed.nodeMarkerPaths[text!.node],
    ).toEqual(['node0', text!.node]);
  });

  it('wraps interpolations after Angular-owned dynamic siblings too', () => {
    const parsed = parseSxTemplate(
      '<p>@if (plain) {started} {{ count }}</p>',
      'inline.html',
      { resolveReactiveSource: path => path === 'count' ? 'count' : undefined },
    );

    const text = parsed.plan.bindings.find(binding => binding.kind.startsWith('text-') && binding.kind.includes('node'));
    expect(text?.name).toBeUndefined();
    expect(
      parsed.bindingEdits.some(edit =>
        edit.replacement.includes('<span data-sx-node="'),
      ),
    ).toBeTrue();
  });

  it('counts whitespace-only text when preserveWhitespaces is enabled', () => {
    const source = '<p> <span>x</span> {{ count }}</p>';
    const resolveReactiveSource = (path: string) => path === 'count' ? 'count' : undefined;

    const defaultRun = parseSxTemplate(source, 'inline.html', { resolveReactiveSource });
    expect(defaultRun.plan.bindings.find(binding => binding.kind.startsWith('text-') && binding.kind.includes('node'))?.name).toBe('0');

    const preserveRun = parseSxTemplate(source, 'inline.html', { resolveReactiveSource, preserveWhitespaces: true });
    expect(preserveRun.plan.bindings.find(binding => binding.kind.startsWith('text-') && binding.kind.includes('node'))?.name).toBe('1');
  });

  it('does not reserve an element slot for an Angular-owned text interpolation', () => {
    const parsed = parseSxTemplate(
      '<section>@if (plain) { started } {{ label }} <span [title]="model.msg"></span></section>',
      'inline.html', { resolveReactiveSource },
    );
    const binding = parsed.plan.bindings.find(item => item.source === "model.get('msg')");
    expect(binding).toBeDefined();
    expect(parsed.nodePaths[binding!.node]).toEqual([0, 0]);
  });

  it('marks root interpolations after dynamic siblings and preserves whitespace in preformatted elements', () => {
    const parsed = parseSxTemplate(
      '@if (plain) { started } {{ model.msg }}',
      'inline.html', { resolveReactiveSource },
    );
    const [root] = parsed.plan.bindings;
    expect(root.dependencies).toEqual(["model.get('msg')"]);
    expect(parsed.bindingEdits.some(edit => edit.replacement.includes(`data-sx-node="${root.node}"`))).toBeTrue();
    const pre = parseSxTemplate('<pre> <span>x</span> {{ model.msg }}</pre>', 'inline.html', { resolveReactiveSource });
    expect(pre.plan.bindings[0]?.name).toBe('1');
  });
});
