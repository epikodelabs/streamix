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
    const parsed = parseSxTemplate(`
      <section>
        text
        <span [sx.text]="count"></span>
        <div><input [sx.value]="name"></div>
      </section>
    `);

    expect(parsed.nodePaths['node0']).toEqual([0]);
    expect(parsed.nodePaths['node1']).toEqual([0, 0]);
    expect(parsed.nodePaths['node2']).toEqual([0, 1]);
    expect(parsed.nodePaths['node3']).toEqual([0, 1, 0]);

    expect(parsed.plan.bindings).toEqual([
      {
        slot: 0,
        kind: 'text',
        node: 'node1',
        source: 'count',
      },
      {
        slot: 1,
        kind: 'property',
        node: 'node3',
        source: 'name',
        name: 'value',
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

});
