import {
  parseSxTemplate,
} from './angular-template-parser';

describe('parseSxTemplate', () => {
  it('preserves sx source expressions from the binding span', () => {
    const parsed = parseSxTemplate(
      `<span [sx.text]="model.count"></span>`,
    );

    expect(parsed.plan.bindings[0]?.source).toBe('model.count');
  });


  it('computes whitespace-independent element paths', () => {
    const template = `
      <section>
        text
        <span [sx.text]="count"></span>
        <div><input [sx.value]="name"></div>
      </section>
    `;
    const parsed = parseSxTemplate(template);

    expect(parsed.nodePaths['node0']).toEqual([0]);
    expect(parsed.nodePaths['node1']).toEqual([0, 0]);
    expect(parsed.nodePaths['node2']).toEqual([0, 1]);
    expect(parsed.nodePaths['node3']).toEqual([0, 1, 0]);

    const spanOf = (attribute: string) => {
      const start = template.indexOf(attribute);
      return { start, end: start + attribute.length };
    };

    expect(parsed.plan.bindings).toEqual([
      {
        slot: 0,
        kind: 'text',
        node: 'node1',
        source: 'count',
        span: spanOf('[sx.text]="count"'),
      },
      {
        slot: 1,
        kind: 'property',
        node: 'node3',
        source: 'name',
        name: 'value',
        span: spanOf('[sx.value]="name"'),
      },
    ]);
  });

  it('rejects sx bindings under structural Angular templates', () => {
    expect(() => parseSxTemplate(`
      @if (visible) {
        <span [sx.text]="count"></span>
      }
    `)).toThrowError(/structural\/template blocks/i);
  });
  it('allows built-in control-flow siblings without compiled bindings', () => {
    const parsed = parseSxTemplate(`
      @if (visible) {
        <span>conditional</span>
      }
      <span [sx.text]="count"></span>
    `);

    expect(parsed.plan.size).toBe(1);
  });

  it('rejects control-flow siblings that contain compiled bindings', () => {
    expect(() => parseSxTemplate(`
      @if (visible) {
        <span [sx.text]="other"></span>
      }
      <span [sx.text]="count"></span>
    `)).toThrowError(/structural\/template blocks/i);
  });

  it('treats ng-container as transparent when computing element paths', () => {
    const parsed = parseSxTemplate(`
      <div></div>
      <ng-container><span [sx.text]="count"></span></ng-container>
      <p></p>
    `);

    expect(parsed.nodePaths['node1']).toEqual([1]);
    expect(parsed.nodePaths['node2']).toEqual([2]);
  });

  it('allows structural directive siblings without compiled bindings', () => {
    const parsed = parseSxTemplate(`
      <div *ngIf="visible"></div>
      <span [sx.text]="count"></span>
    `);

    expect(parsed.plan.size).toBe(1);
  });

  it('rejects structural directive siblings that contain compiled bindings', () => {
    expect(() => parseSxTemplate(`
      <div *ngIf="visible"><span [sx.text]="other"></span></div>
      <span [sx.text]="count"></span>
    `)).toThrowError(/structural\/template blocks/i);
  });

  it('allows custom structural directive siblings without compiled bindings', () => {
    const parsed = parseSxTemplate(`
      <span [sx.text]="count"></span>
      <header *appUnless="cond"></header>
    `);

    expect(parsed.plan.size).toBe(1);
  });

  it('allows content projection next to sx bindings', () => {
    const parsed = parseSxTemplate(`
      <span [sx.text]="count"></span>
      <ng-content></ng-content>
    `);

    expect(parsed.plan.size).toBe(1);
  });

  it('does not reject sx bindings for control-flow text in attribute values', () => {
    const parsed = parseSxTemplate(
      `<span [sx.text]="count" title="@if (visible) { ... }"></span>`,
    );

    expect(parsed.plan.size).toBe(1);
  });




  it('parses dynamic sx class maps as one direct binding', () => {
    const template = '<section [sx.class]="classes"></section>';
    const parsed = parseSxTemplate(template);

    expect(parsed.plan.bindings).toEqual([
      jasmine.objectContaining({
        slot: 0,
        kind: 'class-map',
        node: 'node0',
        source: 'classes',
      }),
    ]);
  });

  it('normalizes camelCase explicit style names for the direct writer', () => {
    const parsed = parseSxTemplate(
      '<main [sx.style.transformOrigin]="origin"></main>',
    );

    expect(parsed.plan.bindings[0]).toEqual(
      jasmine.objectContaining({
        kind: 'style',
        name: 'transform-origin',
        source: 'origin',
      }),
    );
  });

  it('parses dynamic sx style maps as one direct binding', () => {
    const template = '<main [sx.style]="pageStyles"></main>';
    const parsed = parseSxTemplate(template);

    expect(parsed.plan.bindings).toEqual([
      jasmine.objectContaining({
        slot: 0,
        kind: 'style-map',
        node: 'node0',
        source: 'pageStyles',
      }),
    ]);
  });
});