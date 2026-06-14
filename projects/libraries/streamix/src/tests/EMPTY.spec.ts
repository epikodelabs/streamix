import { EMPTY, atom } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('empty', () => {
  it('should auto-complete without emitting any values', async () => {
    const emittedValues: any[] = [];
    EMPTY.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues.length).toBe(0);
  });

  it('should behave the same as an instance of empty atom', async () => {
    const emittedValues: any[] = [];
    EMPTY.subscribe(v => { if (v !== undefined) emittedValues.push(v); });
    await delay();

    expect(emittedValues.length).toBe(0);
  });
});
