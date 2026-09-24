import {
  createBindingPlan,
} from './binding-plan';
import {
  emitBindingTable,
} from './emit-binding-table';

describe('sx compiler binding emitter', () => {
  it('assigns stable integer slots and emits binding-table instructions', () => {
    const plan = createBindingPlan([
      {
        kind: 'text',
        node: 'text0',
        source: 'ctx.count',
      },
      {
        kind: 'property',
        node: 'button0',
        name: 'disabled',
        source: 'ctx.disabled',
      },
      {
        kind: 'class',
        node: 'button0',
        name: 'active',
        source: 'ctx.active',
      },
    ]);

    expect(plan.size).toBe(3);
    expect(plan.bindings.map(binding => binding.slot)).toEqual([0, 1, 2]);

    expect(emitBindingTable(plan)).toBe(
      [
        'const table = createBindingTable(3);',
        'ɵsxText(table, 0, text0, ctx.count);',
        'ɵsxProperty(table, 1, button0, "disabled", ctx.disabled);',
        'ɵsxClass(table, 2, button0, "active", ctx.active);',
      ].join('\n'),
    );
  });
});
