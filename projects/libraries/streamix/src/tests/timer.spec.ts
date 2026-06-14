import { timer } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('timer', () => {
  it('should emit values at specified interval', async () => {
    const intervalMs = 100;
    const atom = timer(0, intervalMs);

    const emittedValues: number[] = [];
    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    await delay(250);
    subscription.unsubscribe();

    expect(emittedValues.length).toBeGreaterThan(1);
    for (let i = 1; i < emittedValues.length; i++) {
      expect(emittedValues[i] - emittedValues[i - 1]).toBe(1);
    }
  });

  it('should stop emitting after unsubscribe', async () => {
    const intervalMs = 100;
    const atom = timer(0, intervalMs);

    const emittedValues: number[] = [];
    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    subscription.unsubscribe();

    const previousLength = emittedValues.length;
    await delay(intervalMs * 2);

    expect(emittedValues.length).toBe(previousLength);
  });

  it('should support promise-based delay and interval inputs', async () => {
    const atom = timer(Promise.resolve(0), Promise.resolve(10));
    const emitted: number[] = [];
    const subscription = atom.subscribe(v => {
      if (v !== undefined) emitted.push(v);
      if (emitted.length === 2) {
        subscription.unsubscribe();
      }
    });

    await delay(50);
    expect(emitted).toEqual([0, 1]);
  });

  it('should use the delay value when no interval is provided', async () => {
    const atom = timer(20);
    const emittedValues: number[] = [];
    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    await delay(80);
    subscription.unsubscribe();

    expect(emittedValues[0]).toBe(0);
    expect(emittedValues[1]).toBe(1);
  });
});
