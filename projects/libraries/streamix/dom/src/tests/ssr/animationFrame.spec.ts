import { on } from '@epikodelabs/streamix/dom';
import { ndescribe } from '../env.spec';

ndescribe('SSR animation frames', () => {
  it('does not schedule a timer when Node has performance but no RAF', async () => {
    expect(typeof performance.now).toBe('function');
    expect(typeof window).toBe('undefined');
    expect(typeof globalThis.requestAnimationFrame).toBe('undefined');
    const schedule = spyOn(globalThis, 'setTimeout').and.callThrough();
    const emit = jasmine.createSpy('frame');
    const source = on('animationFrame');
    const stop = source.subscribe(value => emit(value));
    try {
      await Promise.resolve();
      expect(schedule).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    } finally {
      stop();
      source.dispose();
    }
  });

  it('uses and cancels an explicitly installed RAF in Node', async () => {
    let frame!: FrameRequestCallback;
    let frameId = 41;
    const request = jasmine.createSpy('requestAnimationFrame').and.callFake((callback: FrameRequestCallback) => {
      frame = callback;
      return ++frameId;
    });
    const cancel = jasmine.createSpy('cancelAnimationFrame');
    const emit = jasmine.createSpy('frame');
    const previousRequest = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    const previousCancel = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: request });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: cancel });
    const source = on('animationFrame');
    const stop = source.subscribe(value => emit(value));
    try {
      await Promise.resolve();
      expect(request).toHaveBeenCalledTimes(1);
      await frame(performance.now());
      expect(emit).toHaveBeenCalledOnceWith(0);
      expect(request).toHaveBeenCalledTimes(2);
      stop();
      expect(cancel).toHaveBeenCalledOnceWith(43);
    } finally {
      stop();
      source.dispose();
      if (previousRequest) Object.defineProperty(globalThis, 'requestAnimationFrame', previousRequest);
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
      if (previousCancel) Object.defineProperty(globalThis, 'cancelAnimationFrame', previousCancel);
      else Reflect.deleteProperty(globalThis, 'cancelAnimationFrame');
    }
  });
});
