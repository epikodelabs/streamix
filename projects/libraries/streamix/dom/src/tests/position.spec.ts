import { on, type PointerPosition, type ScrollPosition } from '@epikodelabs/streamix/dom';
import { idescribe } from './env.spec';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function pointer(target: EventTarget, type = 'pointermove', x = 12, y = 24): void {
  const event = new Event(type);
  Object.assign(event, {
    clientX: x, clientY: y, pageX: x + 100, pageY: y + 200,
    pointerId: 7, pointerType: 'pen', isPrimary: true,
    buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5,
  });
  target.dispatchEvent(event);
}

describe('DOM position streams', () => {
  it('shares lazy passive pointer listeners and removes them after the final consumer', async () => {
    const target = new EventTarget();
    const add = spyOn(target, 'addEventListener').and.callThrough();
    const remove = spyOn(target, 'removeEventListener').and.callThrough();
    const positions = on('pointer', target);
    expect(add).not.toHaveBeenCalled();
    const first: PointerPosition[] = [];
    const second: PointerPosition[] = [];
    const stop1 = positions.subscribe(value => first.push(value));
    const stop2 = positions.subscribe(value => second.push(value));
    expect(add.calls.count()).toBe(4);
    expect(add).toHaveBeenCalledWith('pointermove', jasmine.any(Function), { passive: true });
    expect(first).toEqual([]);
    pointer(target);
    await flush();
    expect(first).toEqual([{
      x: 12, y: 24, pageX: 112, pageY: 224, pointerId: 7,
      pointerType: 'pen', isPrimary: true, buttons: 1, pressure: 0.5,
    }]);
    expect(second).toEqual(first);
    stop1();
    expect(remove).not.toHaveBeenCalled();
    stop2();
    expect(remove.calls.count()).toBe(4);
    positions.dispose();
    expect(remove.calls.count()).toBe(4);
  });

  it('emits down, up and cancel snapshots and ignores saved callbacks after cleanup', async () => {
    const target = new EventTarget();
    const add = spyOn(target, 'addEventListener').and.callThrough();
    const positions = on('pointer', target);
    const values: PointerPosition[] = [];
    const stop = positions.subscribe(value => values.push(value));
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
      pointer(target, type);
      await flush();
    }
    expect(values.length).toBe(3);
    expect(values[1].buttons).toBe(0);
    stop();
    const saved = add.calls.first().args[1] as EventListener;
    saved(new Event('pointermove'));
    await flush();
    expect(values.length).toBe(3);
    positions.dispose();
  });

  it('coalesces pending pointer bursts to the latest position', async () => {
    const target = new EventTarget();
    const positions = on('pointer', target);
    const values: PointerPosition[] = [];
    const stop = positions.subscribe(value => values.push(value));
    for (let x = 0; x < 100; x++) pointer(target, 'pointermove', x, x);
    await flush();
    expect(values[values.length - 1].x).toBe(99);
    expect(values.length).toBeLessThan(100);
    stop();
    positions.dispose();
  });

  it('reads element offsets initially and on scroll, retaining fractional and negative offsets', async () => {
    const target = Object.assign(new EventTarget(), { scrollLeft: -1.5, scrollTop: 2.25 });
    const add = spyOn(target, 'addEventListener').and.callThrough();
    const remove = spyOn(target, 'removeEventListener').and.callThrough();
    const positions = on('scroll', target as unknown as Element);
    const values: ScrollPosition[] = [];
    const stop1 = positions.subscribe(value => values.push(value));
    const stop2 = positions.subscribe();
    await flush();
    expect(values).toEqual([{ x: -1.5, y: 2.25 }]);
    expect(add).toHaveBeenCalledOnceWith('scroll', jasmine.any(Function), { passive: true });
    target.scrollLeft = 10;
    target.scrollTop = 42;
    target.dispatchEvent(new Event('scroll'));
    await flush();
    expect(values[1]).toEqual({ x: 10, y: 42 });
    stop1();
    expect(remove).not.toHaveBeenCalled();
    stop2();
    expect(remove).toHaveBeenCalledOnceWith('scroll', jasmine.any(Function));
    positions.dispose();
  });

  it('reads document scrollingElement and window offsets without realm-dependent checks', async () => {
    const documentTarget = Object.assign(new EventTarget(), {
      scrollingElement: { scrollLeft: 3, scrollTop: 4 },
    });
    const windowTarget = Object.assign(new EventTarget(), { scrollX: 5, scrollY: 6 });
    for (const [target, expected] of [[documentTarget, { x: 3, y: 4 }], [windowTarget, { x: 5, y: 6 }]] as const) {
      const positions = on('scroll', target as unknown as Window | Document);
      const values: ScrollPosition[] = [];
      const stop = positions.subscribe(value => values.push(value));
      await flush();
      expect(values[0]).toEqual(expected);
      stop();
      positions.dispose();
    }
  });

  it('reconnects scrolling after the last consumer leaves and supports iterator cleanup', async () => {
    const target = Object.assign(new EventTarget(), { scrollLeft: 0, scrollTop: 1 });
    const add = spyOn(target, 'addEventListener').and.callThrough();
    const remove = spyOn(target, 'removeEventListener').and.callThrough();
    const positions = on('scroll', target as unknown as Element);
    const stop = positions.subscribe();
    await flush();
    stop();
    const iterator = positions[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ x: 0, y: 1 });
    target.scrollTop = 2;
    const next = iterator.next();
    target.dispatchEvent(new Event('scroll'));
    expect((await next).value).toEqual({ x: 0, y: 2 });
    await iterator.return?.();
    expect(add.calls.count()).toBe(2);
    expect(remove.calls.count()).toBe(2);
    positions.dispose();
  });
});

idescribe('browser position streams', () => {
  it('defaults to window and accepts real PointerEvents', async () => {
    const positions = on('pointer');
    const values: PointerPosition[] = [];
    const stop = positions.subscribe(value => values.push(value));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 31, clientY: 47 }));
    await flush();
    expect(values[0].x).toBe(31);
    expect(values[0].y).toBe(47);
    stop();
    positions.dispose();
  });

  it('defaults scrolling to window and reads real elements', async () => {
    const windowPositions = on('scroll');
    const element = document.createElement('div');
    const elementPositions = on('scroll', element);
    const windowValues: ScrollPosition[] = [];
    const elementValues: ScrollPosition[] = [];
    const stopWindow = windowPositions.subscribe(value => windowValues.push(value));
    const stopElement = elementPositions.subscribe(value => elementValues.push(value));
    await flush();
    expect(windowValues[0]).toEqual({ x: window.scrollX, y: window.scrollY });
    expect(elementValues[0]).toEqual({ x: 0, y: 0 });
    stopWindow();
    stopElement();
    windowPositions.dispose();
    elementPositions.dispose();
  });
});
