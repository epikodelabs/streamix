import { RuntimeScheduling, type Scheduler } from '../lib/runtime/scheduling';

describe('runtime transaction cleanup', () => {
  function setup() {
    const scheduling = new RuntimeScheduling();
    const flush = jasmine.createSpy('flush');
    // Targeted flushing is optional for custom schedulers.
    const scheduler: Scheduler = {
      queueFlush() {}, remove() {}, flush, isDirty: false
    };
    scheduling.scheduler = scheduler;
    return { scheduling, flush };
  }

  it('preserves the callback error while running every finalizer and flushing', () => {
    const { scheduling, flush } = setup();
    const callbackError = new Error('callback');
    const finalized: number[] = [];
    expect(() => scheduling.transaction(() => {
      scheduling.finalizeAfterTransaction(() => { finalized.push(1); throw new Error('cleanup'); });
      scheduling.finalizeAfterTransaction(() => { finalized.push(2); });
      throw callbackError;
    })).toThrow(callbackError);
    expect(finalized).toEqual([1, 2]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(scheduling.transactionDepth).toBe(0);
    expect(scheduling.transactionFinalizers.size).toBe(0);
  });

  it('preserves even undefined thrown by the callback when flushing also fails', () => {
    const { scheduling, flush } = setup();
    flush.and.throwError('flush');
    let caught = false;
    try {
      scheduling.transaction(() => { throw undefined; });
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(scheduling.transactionDepth).toBe(0);
  });

  it('reports the first cleanup error when the callback succeeds', () => {
    const { scheduling, flush } = setup();
    const cleanupError = new Error('cleanup');
    flush.and.throwError('flush');
    expect(() => scheduling.transaction(() => {
      scheduling.finalizeAfterTransaction(() => { throw cleanupError; });
    })).toThrow(cleanupError);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('preserves nested callback errors through failing outer finalizers', () => {
    const { scheduling, flush } = setup();
    const callbackError = new Error('nested');
    expect(() => scheduling.transaction(() => {
      scheduling.finalizeAfterTransaction(() => { throw new Error('cleanup'); });
      scheduling.transaction(() => { throw callbackError; });
    })).toThrow(callbackError);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
