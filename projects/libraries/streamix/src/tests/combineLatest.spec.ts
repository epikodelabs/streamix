import { combineLatest, from, timer } from '@epikodelabs/streamix';

const delay = (ms = 10) => new Promise<void>(r => setTimeout(r, ms));

describe('combineLatest', () => {
  it('should combine timer streams correctly', async () => {
    const firstTimer = timer(0, 50);
    const secondTimer = timer(25, 50);

    const combined = combineLatest(firstTimer, secondTimer);
    const emitted: number[][] = [];

    const subscription = combined.subscribe(v => { if (v !== undefined) emitted.push(v); });
    await delay(250);
    subscription.unsubscribe();

    expect(emitted.length).toBeGreaterThan(4);
    expect(emitted[0]).toEqual([0, 0]);
  });

  it('should stop emitting values after cancellation', async () => {
    const firstTimer = timer(0, 50);
    const secondTimer = timer(25, 50);

    const combined = combineLatest(firstTimer, secondTimer);
    let emissionCount = 0;

    const subscription = combined.subscribe(v => {
      if (v !== undefined) {
        emissionCount++;
        subscription.unsubscribe();
      }
    });

    await delay(50);
    expect(emissionCount).toBe(1);
    expect(subscription.unsubscribed).toBe(true);
  });

  it('should combine multiple streams correctly', async () => {
    const firstTimer = timer(0, 500);
    const secondTimer = timer(250, 500);
    const thirdTimer = timer(100, 500);

    const combined = combineLatest(firstTimer, secondTimer, thirdTimer);
    const emitted: number[][] = [];

    const subscription = combined.subscribe(v => { if (v !== undefined) emitted.push(v); });
    await delay(1200);
    subscription.unsubscribe();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0]).toEqual([0, 0, 0]);
  });

  it('should combine from streams and emit values', async () => {
    const firstSource = from([0, 1, 2]);
    const secondSource = from([0, 1, 2]);
    const combined = combineLatest(firstSource, secondSource);
    let nextCalled = false;

    combined.subscribe(() => nextCalled = true);
    await delay();

    expect(nextCalled).toBe(true);
  });

  it('should resolve promise-based inputs before emitting', async () => {
    const combined = combineLatest(Promise.resolve(1), Promise.resolve(2));
    const emitted: number[][] = [];

    combined.subscribe(v => { if (v !== undefined) emitted.push(v); });
    await delay();

    expect(emitted).toEqual([[1, 2]]);
  });

  it('should emit nothing with no sources', async () => {
    const combined = combineLatest();
    const emitted: any[] = [];

    combined.subscribe(v => { if (v !== undefined) emitted.push(v); });
    await delay(50);

    expect(emitted).toEqual([]);
  });
});
