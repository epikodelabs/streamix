import { rewriteDerivedAtomReads } from './generate-project';

describe('Angular derived shorthand', () => {
  it('lowers raw local atom reads inside a derived callback', () => {
    const transformed = rewriteDerivedAtomReads(`
      class Counter {
        price = atom(2);
        quantity = atom(3);
        total = derived(() => this.price * this.quantity);
      }
    `);

    expect(transformed).toContain('derived(() => this.price.value * this.quantity.value)');
  });

  it('lowers lexical atom reads inside a derived callback', () => {
    const transformed = rewriteDerivedAtomReads(`
      const price = atom(2);
      const quantity = atom(3);
      const total = derived(() => price * quantity);
    `);

    expect(transformed).toContain('derived(() => price.value * quantity.value)');
  });
});
