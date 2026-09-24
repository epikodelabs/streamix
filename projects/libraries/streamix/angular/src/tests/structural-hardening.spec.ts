import {
  atom,
} from '@epikodelabs/streamix';

import {
  rendererScheduler,
  ɵcreateSxCompiledBlock,
  type SxCompiledBlockInstance,
  ɵcreateSxFragmentRange,
  ɵcreateSxKeyedBlock,
  ɵcreateSxValueBlock,
} from '../lib';

function textBlock(value: string) {
  const text = document.createTextNode(value);
  const range = ɵcreateSxFragmentRange([text]);

  return ɵcreateSxCompiledBlock(
    range.first,
    range.last,
    context => {
      text.data = context.value;
    },
    { value },
  );
}

idescribe('sx structural hardening', () => {
  afterEach(() => {
    rendererScheduler.flushNow();
  });

  it('coalesces value emissions and renders only the latest value', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const source = atom<string | undefined>('a');
    let updates = 0;

    const block = ɵcreateSxValueBlock(
      anchor,
      source,
      {
        create(value) {
          return textBlock(value);
        },
        update(instance, value) {
          updates += 1;
          (instance as ReturnType<typeof textBlock>).update({
            value,
          });
        },
      },
    );

    source.set('b');
    source.set('c');
    source.set('d');

    rendererScheduler.flushNow();

    expect(host.textContent).toBe('d');
    expect(updates).toBe(1);

    block.destroy();
  });

  it('does not flush stale emissions after rebind', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const first = atom<string | undefined>('first');
    const second = atom<string | undefined>('second');

    const block = ɵcreateSxValueBlock(
      anchor,
      first,
      {
        create(value) {
          return textBlock(value);
        },
        update(instance, value) {
          (instance as ReturnType<typeof textBlock>).update({
            value,
          });
        },
      },
    );

    first.set('stale');
    block.bind(second);

    rendererScheduler.flushNow();

    expect(host.textContent).toBe('second');

    block.destroy();
  });

  it('reuses keyed DOM nodes across reorder', () => {
    type Item = {
      id: number;
      label: string;
    };

    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const source = atom<Iterable<Item> | undefined>([
      { id: 1, label: 'A' },
      { id: 2, label: 'B' },
      { id: 3, label: 'C' },
    ]);

    const block = ɵcreateSxKeyedBlock(
      anchor,
      source,
      {
        create(item) {
          const el = document.createElement('span');
          const text = document.createTextNode(
            item.label,
          );
          el.appendChild(text);

          const range = ɵcreateSxFragmentRange([el]);

          return ɵcreateSxCompiledBlock(
            range.first,
            range.last,
            context => {
              text.data = context.label;
            },
            { label: item.label },
          );
        },
        update(instance, item) {
          (instance as SxCompiledBlockInstance<{ label: string }>).update({
            label: item.label,
          });
        },
      },
      (_index, item) => item.id,
    );

    const before = Array.from(
      host.querySelectorAll('span'),
    );

    source.set([
      { id: 3, label: 'C2' },
      { id: 1, label: 'A2' },
      { id: 2, label: 'B2' },
    ]);

    rendererScheduler.flushNow();

    const after = Array.from(
      host.querySelectorAll('span'),
    );

    expect(after[0]).toBe(before[2]);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(host.textContent).toBe('C2A2B2');

    block.destroy();
  });

  it('rejects duplicate collection keys', () => {
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const source = atom<
      Iterable<{ id: number }> | undefined
    >([
      { id: 1 },
      { id: 1 },
    ]);

    expect(() =>
      ɵcreateSxKeyedBlock(
        anchor,
        source,
        {
          create() {
            return textBlock('');
          },
        },
        (_index, item) => item.id,
      ),
    ).toThrowError(/duplicate sx collection key/i);
  });

  it('destroys removed keyed records exactly once', () => {
    type Item = { id: number };

    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.appendChild(anchor);

    const source = atom<Iterable<Item> | undefined>([
      { id: 1 },
      { id: 2 },
    ]);

    const destroyed = new Map<number, number>();

    const block = ɵcreateSxKeyedBlock(
      anchor,
      source,
      {
        create(item) {
          const text = document.createTextNode(
            String(item.id),
          );

          return {
            first: text,
            last: text,
            destroy() {
              destroyed.set(
                item.id,
                (destroyed.get(item.id) ?? 0) + 1,
              );
            },
          };
        },
      },
      (_index, item) => item.id,
    );

    source.set([{ id: 2 }]);
    rendererScheduler.flushNow();

    expect(destroyed.get(1)).toBe(1);
    expect(destroyed.get(2)).toBeUndefined();

    block.destroy();

    expect(destroyed.get(2)).toBe(1);
  });
});
import { idescribe } from '../../../src/tests/env.spec';
