import { interval, pipe, take } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('interval', () => {
  it('should emit values at specified interval', async () => {
    const intervalMs = 100;
    const atom = pipe(interval(intervalMs), take(3));

    const emittedValues: number[] = [];
    const timestamps: number[] = [];

    atom.subscribe(v => {
      if (v !== undefined) {
        emittedValues.push(v);
        timestamps.push(Date.now());
      }
    });

    await delay(intervalMs * 4);

    expect(emittedValues.length).toBe(3);
    expect(emittedValues).toEqual([0, 1, 2]);

    for (let i = 1; i < timestamps.length; i++) {
      const timeDiff = timestamps[i] - timestamps[i - 1];
      expect(timeDiff).toBeGreaterThanOrEqual(intervalMs - 50);
      expect(timeDiff).toBeLessThanOrEqual(intervalMs + 50);
    }
  });

  it('should stop emitting after unsubscribe', async () => {
    const intervalMs = 100;
    const atom = interval(intervalMs);

    const emittedValues: number[] = [];
    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    await delay(intervalMs * 3);
    subscription.unsubscribe();

    const previousLength = emittedValues.length;
    await delay(intervalMs * 2);

    expect(emittedValues.length).toBe(previousLength);
  });

  it('should stop emitting after cancel', async () => {
    const intervalMs = 100;
    const atom = interval(intervalMs);

    const emittedValues: number[] = [];
    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    subscription.unsubscribe();

    const previousLength = emittedValues.length;
    await delay(intervalMs * 2);

    expect(emittedValues.length).toBe(previousLength);
  });

  it('should emit immediately if interval is 0', async () => {
    const atom = interval(0);

    const emittedValues: number[] = [];
    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    await delay(10);
    expect(emittedValues.length).toBeGreaterThan(0);
    subscription.unsubscribe();
  });

  it('should allow multiple subscriptions', async () => {
    const intervalMs = 100;
    const atom = interval(intervalMs);

    const emittedValues1: number[] = [];
    const emittedValues2: number[] = [];

    const subscription1 = atom.subscribe(v => { if (v !== undefined) emittedValues1.push(v); });
    const subscription2 = atom.subscribe(v => { if (v !== undefined) emittedValues2.push(v); });

    await delay(intervalMs * 3);

    subscription1.unsubscribe();
    subscription2.unsubscribe();

    expect(emittedValues1).toEqual(emittedValues2);

    const previousLength1 = emittedValues1.length;
    const previousLength2 = emittedValues2.length;

    await delay(intervalMs * 2);

    expect(emittedValues1.length).toBe(previousLength1);
    expect(emittedValues2.length).toBe(previousLength2);
  });

  it('should emit at correct intervals and allow unsubscribe in a sequence', async () => {
    const intervalMs = 100;
    const atom = interval(intervalMs);

    const emittedValues: number[] = [];
    const subscription = atom.subscribe(v => { if (v !== undefined) emittedValues.push(v); });

    await delay(intervalMs * 1.5);
    subscription.unsubscribe();

    const firstLength = emittedValues.length;

    await delay(intervalMs * 2);

    expect(emittedValues.length).toBe(firstLength);
  });
});
