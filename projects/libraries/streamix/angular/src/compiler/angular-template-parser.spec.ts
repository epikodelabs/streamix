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
  it('rejects static sx paths when Angular built-in control flow can change topology', () => {
    expect(() => parseSxTemplate(`
      @if (visible) {
        <span>conditional</span>
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

  it('rejects structural directive siblings that shift element paths', () => {
    expect(() => parseSxTemplate(`
      <div *ngIf="visible"></div>
      <span [sx.text]="count"></span>
    `)).toThrowError(/structural\/template blocks/i);
  });

  it('rejects custom structural directive siblings', () => {
    expect(() => parseSxTemplate(`
      <span [sx.text]="count"></span>
      <header *appUnless="cond"></header>
    `)).toThrowError(/structural\/template blocks/i);
  });

  it('rejects content projection next to sx bindings', () => {
    expect(() => parseSxTemplate(`
      <span [sx.text]="count"></span>
      <ng-content></ng-content>
    `)).toThrowError(/structural\/template blocks/i);
  });

  it('does not reject sx bindings for control-flow text in attribute values', () => {
    const parsed = parseSxTemplate(
      `<span [sx.text]="count" title="@if (visible) { ... }"></span>`,
    );

    expect(parsed.plan.size).toBe(1);
  });

});
