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

  it('re-selects an expression branch at most once per flush', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const count = atom(0);
    const limit = atom(10);
    let reads = 0;
    let creates = 0;

    const block = ɵcreateSxConditionalBlock(anchor, [
      {
        source: {
          sources: [count, limit],
          read: () => {
            reads += 1;
            return count.value > limit.value;
          },
        },
        factory: () => {
          creates += 1;
          return elementBlock('strong', 'over');
        },
      },
      { source: null, factory: () => elementBlock('em', 'under') },
    ]);

    expect(host.textContent).toBe('under');

    // Both sources emit before the frame: one render, one read.
    count.next(5);
    limit.next(1);
    const readsBeforeFlush = reads;
    rendererScheduler.flushNow();

    expect(host.textContent).toBe('over');
    expect(creates).toBe(1);
    expect(reads - readsBeforeFlush).toBe(1);

    // An emission that does not change the winner re-reads but keeps the DOM.
    count.next(7);
    rendererScheduler.flushNow();

    expect(host.textContent).toBe('over');
    expect(creates).toBe(1);

    count.next(0);
    rendererScheduler.flushNow();

    expect(host.textContent).toBe('under');

    block.destroy();
    expect(host.textContent).toBe('');
  });

  it('reads a multi-source collection expression once per flush', () => {
    const host = document.createElement('ul');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const first = atom<readonly string[]>(['a']);
    const second = atom<readonly string[]>(['b']);
    let reads = 0;

    const block = ɵcreateSxKeyedBlock(
      anchor,
      {
        sources: [first, second],
        read: () => {
          reads += 1;
          return first.value.concat(second.value);
        },
      },
      {
        create(item: string) {
          return elementBlock('li', item);
        },
      },
      (_index, item) => item,
    );

    expect(host.querySelectorAll('li').length).toBe(2);

    first.next(['a', 'c']);
    second.next(['b', 'd']);
    const readsBeforeFlush = reads;
    rendererScheduler.flushNow();

    expect(reads - readsBeforeFlush).toBe(1);
    expect(
      [...host.querySelectorAll('li')].map(node => node.textContent ?? '').join(','),
    ).toBe('a,c,b,d');

    block.destroy();
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
