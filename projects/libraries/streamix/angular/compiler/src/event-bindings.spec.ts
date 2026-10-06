import {
  transformAngularComponentTemplate,
} from './build-transform';

describe('compiled event bindings', () => {
  it('lowers a native event and removes the Angular binding', () => {
    const result = transformAngularComponentTemplate(
      '<button type="button" (click)="add($event)">Add</button>',
      'inline.html',
    );

    expect(result.template).not.toContain('(click)');
    expect(result.setup).toContain(
      'ɵsxListener(table, 0, node0, "click", (event) => { ctx.add(event); }, undefined, server)',
    );
  });

  it('compiles modifiers into guards and listener options', () => {
    const result = transformAngularComponentTemplate(
      '<div (click.stop.prevent)="stop()" (keyup.enter)="submit()" (scroll.once.capture)="track()"></div>',
      'inline.html',
    );

    expect(result.setup).toContain(
      '(event) => { event.preventDefault(); event.stopPropagation(); ctx.stop(); }',
    );
    expect(result.setup).toContain(
      '(event) => { if (event.key !== "Enter") return; ctx.submit(); }',
    );
    expect(result.setup).toContain('{ once: true, capture: true }');
  });

  it('compiles a handler with literal arguments', () => {
    const result = transformAngularComponentTemplate(
      `<button (click)="select('row', 2)">Pick</button>`,
      'inline.html',
    );

    expect(result.setup).toContain('ctx.select(\'row\', 2)');
  });

  it('keeps component outputs on the Angular path', () => {
    const template = '<app-item (saved)="onSaved($event)"></app-item>';
    const result = transformAngularComponentTemplate(template, 'inline.html');

    expect(result.template).toBe(template);
    expect(result.setup).not.toContain('ɵsxListener');
  });

  it('keeps animations and global targets on the Angular path', () => {
    const template =
      '<div (@fade.done)="done()" (window:scroll)="onScroll()"></div>';
    const result = transformAngularComponentTemplate(template, 'inline.html');

    expect(result.template).toBe(template);
  });

  it('keeps unknown event names and unknown modifiers on the Angular path', () => {
    const template =
      '<div (customThing)="run()" (click.ctrl.shift)="run()"></div>';
    const result = transformAngularComponentTemplate(template, 'inline.html');

    expect(result.template).toBe(template);
  });

  it('keeps assignment handlers on the Angular path', () => {
    const template = '<button (click)="count = count + 1">Add</button>';
    const result = transformAngularComponentTemplate(template, 'inline.html');

    expect(result.template).toBe(template);
  });
});
