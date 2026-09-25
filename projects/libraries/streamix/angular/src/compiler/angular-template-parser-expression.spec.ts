import {
  parseSxTemplate,
} from './angular-template-parser';

describe('sx source expression diagnostics', () => {
  it('accepts DependencySource property paths', () => {
    const parsed = parseSxTemplate(
      '<span [sx.text]="model.count"></span>',
    );

    expect(parsed.plan.size).toBe(1);
  });

  it('rejects calls and arbitrary Angular expressions in explicit sx bindings', () => {
    expect(() =>
      parseSxTemplate(
        '<span [sx.text]="getCount()"></span>',
      ),
    ).toThrowError(/require a component property path/i);

    expect(() =>
      parseSxTemplate(
        '<span [sx.text]="enabled ? yes : no"></span>',
      ),
    ).toThrowError(/require a component property path/i);
  });

  it('lowers an exact .value interpolation to a direct text binding', () => {
    const parsed = parseSxTemplate(
      '<span>{{ count.value }}</span>',
    );

    expect(parsed.plan.bindings).toEqual([
      jasmine.objectContaining({
        slot: 0,
        kind: 'text',
        node: 'node0',
        source: 'count',
      }),
    ]);
    expect(parsed.bindingSpans.length).toBe(1);
  });

  it('lowers a pure Streamix interpolation to a direct text expression', () => {
    const parsed = parseSxTemplate(
      `<span>{{ count.value * price.value }}</span>`,
    );

    expect(parsed.plan.bindings).toEqual([
      jasmine.objectContaining({
        kind: 'text-expression',
        source: 'count.value * price.value',
        dependencies: ['count', 'price'],
      }),
    ]);
    expect(parsed.bindingSpans.length).toBe(1);
  });

  it('keeps a mixed Angular/Streamix interpolation and emits invalidation', () => {
    const parsed = parseSxTemplate(
      `<span>{{ count.value * multiplier }}</span>`,
    );

    expect(parsed.plan.bindings).toEqual([
      jasmine.objectContaining({
        kind: 'angular-invalidate',
        source: 'count.value * multiplier',
        dependencies: ['count'],
      }),
    ]);

    // Hybrid expressions remain in Angular's template graph.
    expect(parsed.bindingSpans).toEqual([]);
  });

  it('lowers simple native Angular .value bindings to direct sx kinds', () => {
    const parsed = parseSxTemplate(`
      <button
        [disabled]="busy.value"
        [attr.aria-label]="label.value"
        [class.active]="active.value"
        [style.opacity]="opacity.value">
        Save
      </button>
    `);

    expect(parsed.plan.bindings.map(binding => ({
      kind: binding.kind,
      source: binding.source,
      name: binding.name,
    }))).toEqual([
      { kind: 'property', source: 'busy', name: 'disabled' },
      { kind: 'attribute', source: 'label', name: 'aria-label' },
      { kind: 'class', source: 'active', name: 'active' },
      { kind: 'style', source: 'opacity', name: 'opacity' },
    ]);
  });

  it('does not steal directive/component inputs or two-way bindings', () => {
    const parsed = parseSxTemplate(`
      <div [ngClass]="classes.value"></div>
      <input [(value)]="field.value">
    `);

    expect(parsed.plan.size).toBe(0);
  });

  it('leaves compound native Angular bindings and unit styles Angular-owned', () => {
    const parsed = parseSxTemplate(`
      <button [disabled]="busy.value || locked"></button>
      <div [style.width.px]="width.value"></div>
    `);

    expect(parsed.plan.size).toBe(0);
  });
});
