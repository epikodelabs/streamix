import { atom, asReadable, lens, NO_INITIAL_VALUE } from '@epikodelabs/streamix';

describe('lens factory', () => {
  it('reads synchronously and preserves the initial value', () => {
    const profile = atom({ name: 'Alex', address: { city: 'Kyiv' } });
    const city = lens(profile, ['address', 'city']);
    const values: string[] = [];
    const sub = city.subscribe(value => values.push(value));

    expect(city.value).toBe('Kyiv');
    expect(values).toEqual(['Kyiv']);

    sub();
    city.dispose();
    profile.dispose();
  });

  it('ignores unrelated source updates', () => {
    const profile = atom({ name: 'Alex', age: 30 });
    const name = lens(profile, 'name');
    const values: string[] = [];
    const sub = name.subscribe(v => values.push(v));

    profile.set({ name: 'Alex', age: 31 });
    expect(name.value).toBe('Alex');
    expect(values).toEqual(['Alex']);

    profile.set({ name: 'Sam', age: 31 });
    expect(name.value).toBe('Sam');
    expect(values).toEqual(['Alex', 'Sam']);

    sub();
    name.dispose();
    profile.dispose();
  });

  it('writes nested values immutably and preserves unrelated branches', () => {
    const profile = atom({
      address: Object.freeze({ city: 'Kyiv', zip: 10000 }),
      metadata: Object.freeze({ active: true }),
    });
    const initial = profile.value;
    const city = lens(profile, ['address', 'city']);

    city.set('Lviv');
    expect(profile.value.address.city).toBe('Lviv');
    expect(profile.value.address.zip).toBe(10000);
    expect(profile.value.metadata).toBe(initial.metadata);
    expect(initial.address.city).toBe('Kyiv');

    city.dispose();
    profile.dispose();
  });

  it('composes lenses and updates the root', () => {
    const profile = atom({ address: { city: 'Kyiv' } });
    const address = lens(profile, 'address');
    const city = lens(address, 'city');

    city.next('Odesa');
    expect(profile.value.address.city).toBe('Odesa');
    expect(city.value).toBe('Odesa');

    city.dispose();
    address.dispose();
    profile.dispose();
  });

  it('never disposes the source when its lens is disposed', () => {
    const state = atom({ value: 1 });
    const value = lens(state, 'value');
    value.dispose();
    expect(state.disposed).toBe(false);
    state.set({ value: 2 });
    expect(state.value.value).toBe(2);
    state.dispose();
  });

  it('returns read-only atoms for read-only sources', () => {
    const source = atom({ count: 1 });
    const count = lens(asReadable(source), 'count');
    expect(count.value).toBe(1);
    expect(typeof (count as any).set).toBe('undefined');
    count.dispose();
    source.dispose();
  });

  it('keeps an unavailable source unavailable', () => {
    const source = atom<{ count: number }>();
    const count = lens(source, 'count');
    expect(count.value).toBe(NO_INITIAL_VALUE as any);
    expect(() => count.set(2)).toThrow();
    source.set({ count: 1 });
    expect(count.value).toBe(1);
    count.dispose();
    source.dispose();
  });

  it('rejects writes through missing intermediate objects', () => {
    const source = atom({ address: undefined as { city: string } | undefined });
    const city = lens(source, ['address', 'city']);
    expect(city.value).toBeUndefined();
    expect(() => city.set('Kyiv')).toThrow();
    city.dispose();
    source.dispose();
  });
});
