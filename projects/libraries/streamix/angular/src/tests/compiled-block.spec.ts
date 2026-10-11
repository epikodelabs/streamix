import {
  ɵcreateSxCompiledBlock,
  ɵcreateSxFragmentRange,
  ɵsxReadLocal,
} from '../lib';

idescribe('compiled sx block runtime', () => {
  it('refreshes an installed body without recreating its DOM node', () => {
    const span = document.createElement('span');
    let outer = 'One';
    let invoked = 0;
    const block = ɵcreateSxCompiledBlock(span, span, () => {
      invoked += 1;
      span.title = outer;
    }, {});
    expect(span.title).toBe('One');
    outer = 'Two';
    block.refresh?.();
    expect(span.title).toBe('Two');
    expect(invoked).toBe(2);
    expect(block.first).toBe(span);
  });

  it('updates compiler-created nodes directly', () => {
    const span = document.createElement('span');
    const text = document.createTextNode('');
    span.appendChild(text);

    const range = ɵcreateSxFragmentRange([span]);

    const block = ɵcreateSxCompiledBlock(
      range.first,
      range.last,
      context => {
        text.data = String(
          ɵsxReadLocal(context, 'user.name') ?? '',
        );
      },
      {
        user: { name: 'Ada' },
      },
    );

    expect(span.textContent).toBe('Ada');

    block.update({
      user: { name: 'Grace' },
    });

    expect(span.textContent).toBe('Grace');
  });
});
import { idescribe } from '../../../src/tests/env.spec';
