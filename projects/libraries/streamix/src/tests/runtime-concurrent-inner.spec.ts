import { ConcurrentInnerExecution } from '../lib/runtime/concurrent-inner-execution';

describe('runtime concurrent inner admission', () => {
  it('starts up to concurrency and drains in FIFO order', () => {
    const started: number[] = [];
    const controller = new ConcurrentInnerExecution<number>(2, 3, value => { started.push(value); });
    [1, 2, 3, 4].forEach(value => controller.accept(value));
    expect(started).toEqual([1, 2]);
    expect(controller.active).toBe(2);
    expect(controller.queued).toBe(2);
    controller.complete();
    expect(started).toEqual([1, 2, 3]);
    controller.complete();
    expect(started).toEqual([1, 2, 3, 4]);
    controller.complete();
    controller.complete();
    expect(controller.idle).toBe(true);
  });

  it('drops the oldest pending value when the buffer is full', () => {
    const started: number[] = [];
    const controller = new ConcurrentInnerExecution<number>(1, 2, value => { started.push(value); });
    [1, 2, 3, 4].forEach(value => controller.accept(value));
    controller.complete();
    controller.complete();
    expect(started).toEqual([1, 3, 4]);
  });

  it('drops overflow immediately when buffer size is zero', () => {
    const started: number[] = [];
    const controller = new ConcurrentInnerExecution<number>(1, 0, value => { started.push(value); });
    controller.accept(1);
    controller.accept(2);
    controller.complete();
    expect(started).toEqual([1]);
    expect(controller.idle).toBe(true);
  });

  it('releases capacity after a projection throws', () => {
    const controller = new ConcurrentInnerExecution<number>(1, 1, value => {
      if (value === 1) throw new Error('projection');
    });
    expect(() => controller.accept(1)).toThrowError('projection');
    expect(controller.active).toBe(0);
    controller.accept(2);
    expect(controller.active).toBe(1);
    controller.close();
    expect(controller.queued).toBe(0);
  });

  it('validates limits', () => {
    expect(() => new ConcurrentInnerExecution(0, 1, () => {})).toThrowError(RangeError);
    expect(() => new ConcurrentInnerExecution(1, -1, () => {})).toThrowError(RangeError);
  });
});
