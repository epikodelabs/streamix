import {
  atom,
} from '@epikodelabs/streamix';

import {
  ɵcreateSxKeyedBlock,
  ɵcreateSxValueBlock,
} from '../lib';
import {
  ɵcreateSxStaticBlock,
  ɵupdateSxStaticBlock,
} from '../lib/static-block';

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
          return ɵcreateSxStaticBlock(
            '<span>{{ value }}</span>',
            { value },
          );
        },
        update(instance, value) {
          ɵupdateSxStaticBlock(instance, { value });
        },
      },
    );

    expect(host.textContent).toBe('one');

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
          return ɵcreateSxStaticBlock(
            '<li>{{ name }}</li>',
            { name: item.name },
          );
        },
        update(instance, item) {
          ɵupdateSxStaticBlock(instance, {
            name: item.name,
          });
        },
      },
      (_index, item) => item.id,
    );

    expect(host.querySelectorAll('li').length).toBe(2);

    block.destroy();

    expect(host.querySelectorAll('li').length).toBe(0);
  });
});
import { idescribe } from '../../../src/tests/env.spec';
