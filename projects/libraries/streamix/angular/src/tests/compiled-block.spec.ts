import {
  ɵcreateSxCompiledBlock,
  ɵcreateSxFragmentRange,
  ɵsxReadLocal,
} from '../lib';

idescribe('compiled sx block runtime', () => {
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
