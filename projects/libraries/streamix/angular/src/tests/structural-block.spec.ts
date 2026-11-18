import {
  atom,
  type DependencySource,
  type Subscription,
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

/**
 * A source that forwards to an atom and counts value subscriptions, so a
 * block's teardown can be observed from the outside.
 */
function countingSource<T>(
  source: DependencySource<T>,
  counters: { subscribed: number; unsubscribed: number },
): DependencySource<T> {
  return {
    get value() {
      return source.value;
    },
    subscribe(callback?: (current: T, previous: T) => unknown): Subscription {
      counters.subscribed += 1;
      const inner = source.subscribe(
        callback as (current: T, previous: T) => unknown,
      );
      const unsubscribe = (): void => {
        if (!inner.unsubscribed) {
          counters.unsubscribed += 1;
        }
        inner();
      };
      return Object.assign(unsubscribe, {
        get unsubscribed() {
          return inner.unsubscribed;
        },
      }) as Subscription;
    },
  };
}

idescribe('sx structural runtime', () => {
  it('applies Angular content styles to generated sparkline bars and descendants', () => {
    const host = document.createElement('div');
    host.setAttribute('_ngcontent-test', '');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);
    const style = document.createElement('style');
    style.textContent = '.spark-bar[_ngcontent-test] { display: block; width: 12px; background: rgb(1, 2, 3); }';
    document.head.appendChild(style);
    document.body.appendChild(host);
    const source = atom([1]);
    const block = ɵcreateSxKeyedBlock(anchor, source, {
      create() {
        const instance = elementBlock('span', '');
        const bar = instance.first as HTMLElement;
        bar.className = 'spark-bar';
        bar.style.height = '20px';
        bar.appendChild(document.createElement('i'));
        return instance;
      },
    }, (_index, item) => item);
    try {
      const bar = host.querySelector('span')!;
      expect(bar.hasAttribute('_ngcontent-test')).toBeTrue();
      expect(bar.firstElementChild!.hasAttribute('_ngcontent-test')).toBeTrue();
      expect(getComputedStyle(bar).width).toBe('12px');
      expect(getComputedStyle(bar).backgroundColor).toBe('rgb(1, 2, 3)');
    } finally {
      block.destroy();
      source.dispose();
      host.remove();
      style.remove();
    }
  });

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

  it('refreshes the existing conditional branch after an enclosing loop-context change', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);
    const ready = atom(true);
    let current = { title: 'First' };
    let created = 0;
    let refreshed = 0;

    const block = ɵcreateSxConditionalBlock(anchor, [{
      source: ready,
      factory: () => {
        created += 1;
        const element = document.createElement('span');
        element.title = current.title;
        return {
          first: element, last: element,
          refresh() { refreshed += 1; element.title = current.title; },
          destroy() { element.remove(); },
        };
      },
    }]);

    const node = host.querySelector('span')!;
    expect(node.title).toBe('First');
    current = { title: 'Second' };
    block.refresh();
    expect(host.querySelector('span')).toBe(node);
    expect(node.title).toBe('Second');
    expect(created).toBe(1);
    expect(refreshed).toBe(1);
    block.destroy();
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

  it('destroys nested blocks exactly once when their keyed row is removed', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const rows = atom<readonly number[]>([1, 2]);
    const counters = { subscribed: 0, unsubscribed: 0 };
    const show = countingSource(atom<boolean | number>(true), counters);

    const block = ɵcreateSxKeyedBlock(anchor, rows, {
      create(_item) {
        const li = document.createElement('li');
        const nestedAnchor = document.createComment('sx');
        li.appendChild(nestedAnchor);

        const nested = ɵcreateSxConditionalBlock(nestedAnchor, [
          {
            source: show,
            factory: () => {
              // Two chained roots: the row's teardown removes this range
              // before the nested block is destroyed.
              const first = document.createElement('span');
              const last = document.createElement('span');
              const fragment = document.createDocumentFragment();
              fragment.appendChild(first);
              fragment.appendChild(last);
              return { first, last, destroy() { first.remove(); last.remove(); } };
            },
          },
          { source: null, factory: () => elementBlock('em', 'pending') },
        ]);

        return {
          first: li,
          last: li,
          destroy() {
            // Mirrors the compiled-instance destroy callback the compiler
            // emits for a row body that owns nested blocks.
            nested.destroy();
          },
        };
      },
    }, (_index, item) => item);

    expect(host.querySelectorAll('li').length).toBe(2);
    expect(counters.subscribed).toBe(2);
    expect(counters.unsubscribed).toBe(0);

    rows.next([2]);
    rendererScheduler.flushNow();

    // Removing row 1 destroyed its nested block exactly once, after the
    // row's DOM was already removed.
    expect(counters.unsubscribed).toBe(1);
    expect(host.querySelectorAll('li').length).toBe(1);

    block.destroy();

    expect(counters.unsubscribed).toBe(2);
    expect(host.querySelectorAll('li').length).toBe(0);
  });

  it('destroys a nested block after its enclosing branch was removed', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const outer = atom<boolean | number>(true);
    const counters = { subscribed: 0, unsubscribed: 0 };
    const inner = countingSource(atom(true), counters);

    const block = ɵcreateSxConditionalBlock(anchor, [
      {
        source: outer,
        factory: () => {
          const first = document.createElement('span');
          const nestedAnchor = document.createComment('sx');
          const last = document.createElement('span');
          const fragment = document.createDocumentFragment();
          fragment.appendChild(first);
          fragment.appendChild(nestedAnchor);
          fragment.appendChild(last);

          const nested = ɵcreateSxConditionalBlock(nestedAnchor, [
            { source: inner, factory: () => elementBlock('b', 'in') },
          ]);

          return {
            first,
            last,
            destroy() {
              nested.destroy();
            },
          };
        },
      },
      { source: null, factory: () => elementBlock('em', 'waiting') },
    ]);

    expect(host.querySelector('b')?.textContent).toBe('in');
    expect(counters.subscribed).toBe(1);

    // The branch swap removes the branch range before the destroy callback
    // runs, so the nested teardown walks an already-removed range.
    outer.next(false);
    rendererScheduler.flushNow();

    expect(host.querySelector('b')).toBeNull();
    expect(counters.unsubscribed).toBe(1);

    block.destroy();
    expect(counters.unsubscribed).toBe(1);
  });

  it('mounts an empty branch through a stable zero-node anchor', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const show = atom<boolean | number>(false);

    const block = ɵcreateSxConditionalBlock(anchor, [
      {
        source: show,
        factory: () => {
          // Mirrors the compiler's anchored empty body.
          const empty = document.createComment('sx:empty');
          return { first: empty, last: empty, destroy() { empty.remove(); } };
        },
      },
      { source: null, factory: () => elementBlock('em', 'waiting') },
    ]);

    expect(host.textContent).toBe('waiting');

    show.next(true);
    rendererScheduler.flushNow();
    expect(host.textContent).toBe('');

    show.next(false);
    rendererScheduler.flushNow();
    expect(host.textContent).toBe('waiting');

    show.next(1);
    rendererScheduler.flushNow();
    expect(host.textContent).toBe('');

    block.destroy();
    expect(host.childNodes.length).toBe(1);
  });

  it('retries a conditional branch whose factory threw once', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const ready = atom<boolean | number>(false);
    let attempts = 0;

    const block = ɵcreateSxConditionalBlock(anchor, [
      {
        source: ready,
        factory: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('transient setup failure');
          }
          return elementBlock('strong', 'ready');
        },
      },
      { source: null, factory: () => elementBlock('em', 'waiting') },
    ]);

    expect(host.textContent).toBe('waiting');
    expect(attempts).toBe(0);

    // The failed swap removes the previous branch, throws during the flush
    // and must not wedge the block on the failed selection.
    ready.next(true);
    const errors = spyOn(console, 'error');
    rendererScheduler.flushNow();

    expect(attempts).toBe(1);
    expect(errors).toHaveBeenCalled();
    expect(host.textContent).toBe('');

    // The same selection re-creates the branch instead of refreshing nothing.
    ready.next(1);
    rendererScheduler.flushNow();

    expect(attempts).toBe(2);
    expect(host.textContent).toBe('ready');

    block.destroy();
    expect(host.textContent).toBe('');
  });

  it('retries a value block whose factory threw once', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    let current: string | undefined = 'a';
    let emit: ((value: string | undefined) => void) | undefined;
    const source: DependencySource<string | undefined> = {
      get value() {
        return current;
      },
      subscribe(
        callback?: (current: string | undefined, previous: string | undefined) => unknown,
      ) {
        emit = (value: string | undefined) => {
          const previous = current;
          current = value;
          callback?.(value, previous);
        };
        return Object.assign(() => undefined, {
          get unsubscribed() {
            return true;
          },
        }) as Subscription;
      },
    };

    let attempts = 0;
    const block = ɵcreateSxValueBlock(
      anchor,
      source,
      {
        create(item) {
          attempts += 1;
          if (attempts === 2) {
            throw new Error('transient setup failure');
          }
          return elementBlock('span', item);
        },
      },
    );

    expect(host.textContent).toBe('a');
    expect(attempts).toBe(1);

    const errors = spyOn(console, 'error');

    // Removing the instance first puts the next emission on the create path.
    emit!(undefined);
    rendererScheduler.flushNow();
    expect(host.textContent).toBe('');

    emit!('b');
    rendererScheduler.flushNow();

    expect(attempts).toBe(2);
    expect(errors).toHaveBeenCalled();
    expect(host.textContent).toBe('');

    // Re-emitting the failed value re-creates the instance instead of being
    // skipped as unchanged.
    emit!('b');
    rendererScheduler.flushNow();

    expect(attempts).toBe(3);
    expect(host.textContent).toBe('b');

    block.destroy();
    expect(host.textContent).toBe('');
  });

  it('retries a keyed row whose factory threw once', () => {
    const host = document.createElement('ul');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const rows = atom<readonly number[]>([1]);
    let attempts = 0;

    const block = ɵcreateSxKeyedBlock(anchor, rows, {
      create(item) {
        attempts += 1;
        if (attempts === 2) {
          throw new Error('transient row failure');
        }
        return elementBlock('li', String(item));
      },
    }, (_index, item) => item);

    const initialRow = host.querySelector('li');
    expect(initialRow?.textContent).toBe('1');

    const errors = spyOn(console, 'error');

    rows.next([1, 2]);
    rendererScheduler.flushNow();

    // The failed render did not commit the new record set: the reused row
    // keeps its DOM and the collection stays consistent.
    expect(attempts).toBe(2);
    expect(errors).toHaveBeenCalled();
    expect(host.querySelectorAll('li').length).toBe(1);
    expect(host.querySelector('li')).toBe(initialRow);

    rows.next([1, 2]);
    rendererScheduler.flushNow();

    expect(attempts).toBe(3);
    expect(host.querySelectorAll('li').length).toBe(2);
    expect(host.querySelector('li')).toBe(initialRow);

    block.destroy();
    expect(host.querySelectorAll('li').length).toBe(0);
  });

  it('destroys instances created before a keyed render throws', () => {
    const host = document.createElement('ul');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const rows = atom<readonly number[]>([2]);
    let destroyed = 0;
    let failRowOne = true;

    const block = ɵcreateSxKeyedBlock(anchor, rows, {
      create(item) {
        if (item === 1 && failRowOne) {
          failRowOne = false;
          throw new Error('transient row failure');
        }
        const li = document.createElement('li');
        li.textContent = String(item);
        return {
          first: li,
          last: li,
          destroy() {
            destroyed += 1;
            li.remove();
          },
        };
      },
    }, (_index, item) => item);

    expect(host.querySelectorAll('li').length).toBe(1);

    const errors = spyOn(console, 'error');

    // Row 3 is created and mounted before row 1's factory throws; the failed
    // pass must release row 3 instead of leaking its DOM and subscriptions.
    rows.next([3, 1]);
    rendererScheduler.flushNow();

    expect(destroyed).toBe(1);
    expect(errors).toHaveBeenCalled();
    expect(host.querySelectorAll('li').length).toBe(1);
    expect(host.querySelector('li')?.textContent).toBe('2');

    // The retried pass creates fresh instances; the stale row 2 leaves with
    // the collection change and nothing is destroyed twice.
    rows.next([3, 1]);
    rendererScheduler.flushNow();

    expect(destroyed).toBe(2);
    expect([...host.querySelectorAll('li')].map(node => node.textContent)).toEqual(['3', '1']);

    block.destroy();
    expect(destroyed).toBe(4);
    expect(host.querySelectorAll('li').length).toBe(0);
  });
});
