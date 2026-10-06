import {
  atom,
} from '@epikodelabs/streamix';

import {
  ɵcreateSxConditionalBlock,
  ɵcreateSxKeyedBlock,
  ɵcreateSxValueBlock,
  type SxBlockInstance,
} from '../lib';
import {
  rendererScheduler,
} from '../lib/render-scheduler';

import { idescribe } from '../../../src/tests/env.spec';

function elementBlock(tag: string, text: string): SxBlockInstance {
  const element = document.createElement(tag);
  element.textContent = text;

  return {
    first: element,
    last: element,
    destroy() {
      element.remove();
    },
  };
}

idescribe('sx structural runtime', () => {
  it('creates and destroys a direct value block', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const source = atom<string | undefined>('one');

    const block = ɵcreateSxValueBlock(
      anchor,
      source,
      {
        create(value) {
          return elementBlock('span', value);
        },
        update(instance, value) {
          (instance.first as HTMLElement).textContent = value;
        },
      },
    );

    expect(host.textContent).toBe('one');

    block.destroy();

    expect(host.textContent).toBe('');
  });

  it('selects and swaps conditional branches without Angular views', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const ready = atom(false);

    const block = ɵcreateSxConditionalBlock(anchor, [
      { source: ready, factory: () => elementBlock('strong', 'ready') },
      { source: null, factory: () => elementBlock('em', 'waiting') },
    ]);

    expect(host.textContent).toBe('waiting');

    ready.next(true);
    rendererScheduler.flushNow();
    expect(host.textContent).toBe('ready');

    ready.next(false);
    rendererScheduler.flushNow();
    expect(host.textContent).toBe('waiting');

    block.destroy();

    expect(host.textContent).toBe('');
  });

  it('creates keyed records without Angular views', () => {
    const host = document.createElement('ul');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const source = atom<
      Iterable<{ id: number; name: string }> | undefined
    >([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);

    const block = ɵcreateSxKeyedBlock(
      anchor,
      source,
      {
        create(item) {
          return elementBlock('li', item.name);
        },
        update(instance, item) {
          (instance.first as HTMLElement).textContent = item.name;
        },
      },
      (_index, item) => item.id,
    );

    expect(host.querySelectorAll('li').length).toBe(2);

    block.destroy();

    expect(host.querySelectorAll('li').length).toBe(0);
  });
});
