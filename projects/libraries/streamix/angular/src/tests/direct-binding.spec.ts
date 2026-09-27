import { atom } from '@epikodelabs/streamix';

import {
  bindAttribute,
  bindClass,
  bindClassMap,
  bindProperty,
  bindStyle,
  bindStyleMap,
  bindText,
} from '../lib/direct-binding';
import {
  RendererScheduler,
  type CancelRender,
  type RenderScheduler,
} from '../lib/render-scheduler';

class ManualFrameScheduler implements RenderScheduler {
  private callback?: () => void;

  schedule(callback: () => void): CancelRender {
    this.callback = callback;

    return () => {
      if (this.callback === callback) {
        this.callback = undefined;
      }
    };
  }

  flush(): void {
    const callback = this.callback;
    this.callback = undefined;
    callback?.();
  }
}

idescribe('direct bindings', () => {
  it('coalesces many bindings through one renderer scheduler', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);

    const a = atom(0);
    const b = atom('a');
    const ta = document.createTextNode('');
    const tb = document.createTextNode('');

    const ba = bindText(a, ta, { scheduler });
    const bb = bindText(b, tb, { scheduler });

    a.set(1);
    a.set(2);
    b.set('b');

    expect(ta.textContent).toBe('0');
    expect(tb.textContent).toBe('a');
    expect(scheduler.pendingCount).toBe(2);

    frame.flush();

    expect(ta.textContent).toBe('2');
    expect(tb.textContent).toBe('b');

    ba.destroy();
    bb.destroy();
  });

  it('writes properties directly', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const value = atom('first');
    const input = document.createElement('input');

    const binding = bindProperty(value, input, 'value', { scheduler });

    expect(input.value).toBe('first');
    expect(scheduler.pendingCount).toBe(0);

    value.set('second');
    frame.flush();

    expect(input.value).toBe('second');

    binding.destroy();
  });

  it('writes attributes directly', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const value = atom<unknown>('button');
    const element = document.createElement('div');

    const binding = bindAttribute(value, element, 'role', { scheduler });

    expect(element.getAttribute('role')).toBe('button');

    value.set(null);
    frame.flush();

    expect(element.hasAttribute('role')).toBeFalse();

    binding.destroy();
  });

  it('toggles classes directly', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const active = atom(false);
    const element = document.createElement('div');

    const binding = bindClass(active, element, 'active', { scheduler });

    expect(element.classList.contains('active')).toBeFalse();

    active.set(true);
    frame.flush();

    expect(element.classList.contains('active')).toBeTrue();

    binding.destroy();
  });


  it('diffs class maps directly', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const classes = atom<Record<string, unknown>>({ active: true, stale: false });
    const element = document.createElement('div');
    element.classList.add('static');

    const binding = bindClassMap(classes, element, { scheduler });

    expect(element.classList.contains('static')).toBeTrue();
    expect(element.classList.contains('active')).toBeTrue();
    expect(element.classList.contains('stale')).toBeFalse();

    classes.set({ fresh: true, active: false });
    frame.flush();

    expect(element.classList.contains('static')).toBeTrue();
    expect(element.classList.contains('active')).toBeFalse();
    expect(element.classList.contains('stale')).toBeFalse();
    expect(element.classList.contains('fresh')).toBeTrue();

    binding.destroy();
  });

  it('writes styles directly', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const width = atom<unknown>('10px');
    const element = document.createElement('div');

    const binding = bindStyle(width, element, 'width', { scheduler });

    expect(element.style.width).toBe('10px');

    width.set('20px');
    frame.flush();

    expect(element.style.width).toBe('20px');

    binding.destroy();
  });



  it('normalizes camelCase direct style names', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const origin = atom<unknown>('top center');
    const element = document.createElement('div');

    const binding = bindStyle(origin, element, 'transformOrigin', { scheduler });

    expect(element.style.transformOrigin).toBe('top center');

    origin.set('bottom center');
    frame.flush();

    expect(element.style.transformOrigin).toBe('bottom center');
    binding.destroy();
  });

  it('diffs style maps directly', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const styles = atom<Record<string, unknown>>({
      transform: 'scale(0.75)',
      transformOrigin: 'center center',
    });
    const element = document.createElement('div');
    element.style.color = 'red';

    const binding = bindStyleMap(styles, element, { scheduler });

    expect(element.style.transform).toBe('scale(0.75)');
    expect(element.style.transformOrigin).toBe('center center');
    expect(element.style.color).toBe('red');

    styles.set({ transform: 'scale(0.5)' });
    frame.flush();

    expect(element.style.transform).toBe('scale(0.5)');
    expect(element.style.transformOrigin).toBe('');
    expect(element.style.color).toBe('red');

    binding.destroy();
  });

  it('rejects sanitizer-sensitive style-map properties', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const styles = atom({ backgroundImage: 'url(https://example.test/x.png)' });
    const element = document.createElement('div');

    expect(() => bindStyleMap(styles, element, { scheduler }))
      .toThrowError(/sanitization/i);
  });
});
import { idescribe } from '../../../src/tests/env.spec';