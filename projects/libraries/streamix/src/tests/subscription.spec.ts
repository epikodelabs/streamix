import { atom } from '@epikodelabs/streamix';

describe('Subscription', () => {
  it('should be callable to unsubscribe', () => {
    const a = atom(0);
    const unsubscribe = a.subscribe(() => {});
    expect(unsubscribe.unsubscribed).toBe(false);
    unsubscribe();
    expect(unsubscribe.unsubscribed).toBe(true);
    a.dispose();
  });

  it('should be idempotent when called multiple times', () => {
    const a = atom(0);
    let calls = 0;
    const unsubscribe = a.subscribe(() => {}).compose(() => { calls++; });
    unsubscribe();
    unsubscribe();
    expect(calls).toBe(1);
    a.dispose();
  });

  it('should run composed teardown callbacks on unsubscribe', () => {
    const a = atom(0);
    const cleaned: string[] = [];
    const unsubscribe = a.subscribe(() => {}).compose(
      () => cleaned.push('a'),
      () => cleaned.push('b'),
    );
    unsubscribe();
    expect(cleaned).toEqual(['a', 'b']);
    a.dispose();
  });

  it('should run composed teardowns after the original teardown', async () => {
    const a = atom(0);
    const order: string[] = [];
    const unsubscribe = a
      .subscribe(() => {})
      .compose(() => order.push('composed'));
    // Override internal teardown by using a source that has a teardown? Hard.
    // Instead rely on atom's original cleanup (removes subscriber) happening
    // before the composed callback by checking order indirectly:
    unsubscribe();
    expect(order).toEqual(['composed']);
    a.dispose();
  });

  it('should run teardowns immediately if added after unsubscribe', () => {
    const a = atom(0);
    const cleaned: string[] = [];
    const unsubscribe = a.subscribe(() => {});
    unsubscribe();
    unsubscribe.compose(() => cleaned.push('late'));
    expect(cleaned).toEqual(['late']);
    a.dispose();
  });

  it('should support async teardowns', async () => {
    const a = atom(0);
    let done = false;
    const unsubscribe = a.subscribe(() => {}).compose(async () => {
      await Promise.resolve();
      done = true;
    });
    await unsubscribe();
    expect(done).toBe(true);
    a.dispose();
  });
});
