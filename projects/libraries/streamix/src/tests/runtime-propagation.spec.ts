import { atom, derived, transaction } from '@epikodelabs/streamix';

describe('runtime graph propagation', () => {
  it('delivers a diamond result once after both upstream branches settle', () => {
    const source = atom(1);
    const left = derived(() => source.value * 2);
    const right = derived(() => source.value + 10);
    const combined = derived(() => left.value + right.value);
    const values: number[] = [];
    combined.subscribe(value => values.push(value));
    expect(values).toEqual([13]);

    transaction(() => source.set(2));
    expect(combined.value).toBe(16);
    expect(values).toEqual([13, 16]);
    combined.dispose(); right.dispose(); left.dispose(); source.dispose();
  });

  it('does not publish partial results from multi-source transactions', () => {
    const first = atom(1);
    const second = atom(2);
    const left = derived(() => first.value + second.value);
    const right = derived(() => first.value * second.value);
    const combined = derived(() => left.value + right.value);
    const values: number[] = [];
    combined.subscribe(value => values.push(value));

    transaction(() => {
      first.set(3);
      second.set(4);
      expect(values).toEqual([5]);
    });
    expect(values).toEqual([5, 19]);
    combined.dispose(); right.dispose(); left.dispose(); second.dispose(); first.dispose();
  });

  it('drops obsolete conditional edges before the next source change', () => {
    const choice = atom(true);
    const a = atom(1);
    const b = atom(10);
    const selected = derived(() => choice.value ? a.value : b.value);
    const values: number[] = [];
    selected.subscribe(value => values.push(value));

    transaction(() => choice.set(false));
    transaction(() => a.set(2));
    transaction(() => b.set(11));
    expect(values).toEqual([1, 10, 11]);
    selected.dispose(); b.dispose(); a.dispose(); choice.dispose();
  });
});
