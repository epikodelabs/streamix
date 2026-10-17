import { RuntimeScheduling } from '../lib/runtime/scheduling';

describe('runtime transaction finalization', () => {
  it('runs all finalizers and flushes even when a finalizer throws', () => {
    const scheduling = new RuntimeScheduling();
    const order: string[] = [];
    scheduling.scheduler = {
      queueFlush() {}, remove() {}, flushImmediately() {},
      get isDirty() { return false; },
      flush() { order.push('flush'); },
    };
    expect(() => scheduling.transaction(() => {
      scheduling.finalizeAfterTransaction(() => { order.push('first'); throw new Error('finalizer'); });
      scheduling.finalizeAfterTransaction(() => { order.push('second'); });
    })).toThrowError('finalizer');
    expect(order).toEqual(['first', 'second', 'flush']);
    expect(scheduling.transactionDepth).toBe(0);
    expect(scheduling.transactionFinalizers.size).toBe(0);
  });

  it('finalizes and flushes after a callback throws', () => {
    const scheduling = new RuntimeScheduling();
    const order: string[] = [];
    scheduling.scheduler = {
      queueFlush() {}, remove() {}, flushImmediately() {},
      get isDirty() { return false; },
      flush() { order.push('flush'); },
    };
    expect(() => scheduling.transaction(() => {
      scheduling.finalizeAfterTransaction(() => order.push('finalize'));
      throw new Error('callback');
    })).toThrowError('callback');
    expect(order).toEqual(['finalize', 'flush']);
  });
});
