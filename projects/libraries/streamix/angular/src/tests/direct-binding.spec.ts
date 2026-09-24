import { atom } from '@epikodelabs/streamix';

import {
  bindAttribute,
  bindClass,
  bindProperty,
  bindStyle,
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
});
import { idescribe } from '../../../src/tests/env.spec';
