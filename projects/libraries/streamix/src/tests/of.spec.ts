import {of} from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('of', () => {
  it('should emit the given value', async () => {
    const value = 'test_value';
    const atom = of(value);

    const emittedValues: string[] = [];
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual([value]);
  });

  it('should emit the value and then have no further emissions', async () => {
    const value = 'test_value';
    const atom = of(value);

    const emittedValues: string[] = [];
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual([value]);

    await delay(30);
    expect(emittedValues).toEqual([value]);
  });

  it('should not emit value if unsubscribed before run', async () => {
    const value = 'test_value';
    const atom = of(value);

    const emittedValues: string[] = [];
    const unsubscribe = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    unsubscribe();

    await delay();
    expect(emittedValues).toEqual([]);
  });

  it('should resolve promised values before emitting', async () => {
    const value$ = Promise.resolve('async_value');
    const emittedValues: string[] = [];

    const atom = of(value$);
    atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues).toEqual(['async_value']);
  });
});
