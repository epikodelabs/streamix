import { atom } from '@epikodelabs/streamix';

import {
  createBindingTable,
  ɵsxAttribute,
  ɵsxClass,
  ɵsxClassMap,
  ɵsxListener,
  ɵsxProperty,
  ɵsxStyle,
  ɵsxStyleMap,
  ɵsxText,
} from '../lib/binding-table';
import {
  RendererScheduler,
  type CancelRender,
  type RenderScheduler,
} from '../lib/render-scheduler';

class ManualFrameScheduler implements RenderScheduler {
  callback?: () => void;
  scheduleCount = 0;

  schedule(callback: () => void): CancelRender {
    this.scheduleCount += 1;
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

idescribe('SxBindingTable', () => {
  it('writes initial values synchronously', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const table = createBindingTable(2, scheduler);

    const count = atom(1);
    const disabled = atom(false);

    const text = document.createTextNode('');
    const button = document.createElement('button');

    ɵsxText(table, 0, text, count);
    ɵsxProperty(table, 1, button, 'disabled', disabled);

    expect(text.textContent).toBe('1');
    expect(button.disabled).toBeFalse();
    expect(table.pendingCount).toBe(0);
    expect(frame.scheduleCount).toBe(0);

    table.destroy();
  });

  it('uses one table scheduler entry for many dirty slots', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const table = createBindingTable(3, scheduler);

    const a = atom(0);
    const b = atom('a');
    const active = atom(false);

    const textA = document.createTextNode('');
    const textB = document.createTextNode('');
    const div = document.createElement('div');

    ɵsxText(table, 0, textA, a);
    ɵsxText(table, 1, textB, b);
    ɵsxClass(table, 2, div, 'active', active);

    a.set(1);
    a.set(2);
    b.set('b');
    active.set(true);

    expect(table.pendingCount).toBe(3);
    expect(frame.scheduleCount).toBe(1);

    frame.flush();

    expect(textA.textContent).toBe('2');
    expect(textB.textContent).toBe('b');
    expect(div.classList.contains('active')).toBeTrue();

    table.destroy();
  });

  it('supports all compiler instructions', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const table = createBindingTable(4, scheduler);

    const value = atom('hello');
    const role = atom<unknown>('button');
    const active = atom(false);
    const width = atom<unknown>('10px');

    const input = document.createElement('input');
    const div = document.createElement('div');

    ɵsxProperty(table, 0, input, 'value', value);
    ɵsxAttribute(table, 1, div, 'role', role);
    ɵsxClass(table, 2, div, 'active', active);
    ɵsxStyle(table, 3, div, 'width', width);

    value.set('world');
    role.set(null);
    active.set(true);
    width.set('20px');

    frame.flush();

    expect(input.value).toBe('world');
    expect(div.hasAttribute('role')).toBeFalse();
    expect(div.classList.contains('active')).toBeTrue();
    expect(div.style.width).toBe('20px');

    table.destroy();
  });

  it('isolates a throwing slot writer and flushes sibling slots', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const table = createBindingTable(2, scheduler);
    spyOn(console, 'error');

    const count = atom(1);
    const label = atom('a');

    const text = document.createTextNode('');
    const span = document.createElement('span');

    table.bind(0, count, value => {
      if (value === 2) {
        throw new Error('write failed');
      }
      text.textContent = String(value);
    });
    table.bind(1, label, value => {
      span.textContent = String(value);
    });

    count.set(2);
    label.set('b');

    frame.flush();

    expect(text.textContent).toBe('1');
    expect(span.textContent).toBe('b');
    expect(console.error).toHaveBeenCalledTimes(1);

    // The slot keeps its previous rendered value, so a later emission
    // retries the write.
    count.set(3);

    frame.flush();

    expect(text.textContent).toBe('3');
    expect(console.error).toHaveBeenCalledTimes(1);

    table.destroy();
  });

  it('rejects invalid slots', () => {
    const table = createBindingTable(1);
    const source = atom(1);
    const text = document.createTextNode('');

    expect(() => ɵsxText(table, 1, text, source)).toThrowError(RangeError);

    table.destroy();
  });



  it('supports a dynamic class-map instruction', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const table = createBindingTable(1, scheduler);
    const classes = atom<Record<string, unknown>>({ active: true, stale: false });
    const div = document.createElement('div');
    div.classList.add('static');

    ɵsxClassMap(table, 0, div, classes);

    expect(div.classList.contains('static')).toBeTrue();
    expect(div.classList.contains('active')).toBeTrue();
    expect(div.classList.contains('stale')).toBeFalse();

    classes.set({ fresh: true, active: false });
    frame.flush();

    expect(div.classList.contains('static')).toBeTrue();
    expect(div.classList.contains('active')).toBeFalse();
    expect(div.classList.contains('stale')).toBeFalse();
    expect(div.classList.contains('fresh')).toBeTrue();

    table.destroy();
  });

  it('supports a dynamic style-map instruction', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const table = createBindingTable(1, scheduler);
    const styles = atom<Record<string, unknown>>({ transform: 'scale(1)', opacity: '0.8' });
    const div = document.createElement('div');

    ɵsxStyleMap(table, 0, div, styles);

    expect(div.style.transform).toBe('scale(1)');
    expect(div.style.opacity).toBe('0.8');

    styles.set({ transform: 'scale(0.5)' });
    frame.flush();

    expect(div.style.transform).toBe('scale(0.5)');
    expect(div.style.opacity).toBe('');

    table.destroy();
  });

  it('installs listeners and removes them on destroy and unbind', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const table = createBindingTable(2, scheduler);
    const button = document.createElement('button');
    document.body.appendChild(button);
    let clicks = 0;

    ɵsxListener(table, 0, button, 'click', () => {
      clicks += 1;
    });
    ɵsxListener(table, 1, button, 'click', () => {
      clicks += 1;
    });

    button.click();
    expect(clicks).toBe(2);

    // Re-binding a slot replaces its listener without doubling it.
    ɵsxListener(table, 1, button, 'click', () => {
      clicks += 1;
    });
    button.click();
    expect(clicks).toBe(4);

    table.unbind(0);
    button.click();
    expect(clicks).toBe(5);

    table.destroy();

    // Destroying twice must not throw or remove anything twice.
    table.destroy();
    button.click();
    expect(clicks).toBe(5);

    button.remove();
  });

  it('attaches no listeners while server rendering', () => {
    const frame = new ManualFrameScheduler();
    const scheduler = new RendererScheduler(frame);
    const table = createBindingTable(1, scheduler);
    const button = document.createElement('button');
    document.body.appendChild(button);
    let clicks = 0;

    ɵsxListener(
      table,
      0,
      button,
      'click',
      () => {
        clicks += 1;
      },
      undefined,
      true,
    );

    button.click();
    expect(clicks).toBe(0);

    table.destroy();
    button.remove();
  });
});
import { idescribe } from '../../../src/tests/env.spec';