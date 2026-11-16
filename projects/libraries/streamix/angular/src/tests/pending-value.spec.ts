import { atom, flow } from '@epikodelabs/streamix';
import { createBindingTable } from '../lib/binding-table';
import { bindClass, bindText } from '../lib/direct-binding';
import { ɵcreateSxConditionalBlock, ɵcreateSxValueBlock, ɵcreateSxKeyedBlock, type SxBlockInstance } from '../lib/structural-block';
import { rendererScheduler, animationFrameRenderScheduler } from '../lib/render-scheduler';
import { idescribe } from '../../../src/tests/env.spec';

function block(text: string): SxBlockInstance {
  const node = document.createTextNode(text);
  return { first: node, last: node, destroy: () => node.remove() };
}

idescribe('Angular pending view values', () => {
  let flush: (() => void) | undefined;
  beforeEach(() => {
    rendererScheduler.setScheduler({ schedule(callback) {
      flush = callback;
      return () => { flush = undefined; };
    } });
  });
  afterEach(() => rendererScheduler.setScheduler(animationFrameRenderScheduler));

  it('normalizes direct and compiled binding values before DOM writes', () => {
    const source = atom<string>();
    const text = document.createTextNode('');
    const element = document.createElement('div');
    const textBinding = bindText(source, text);
    const classBinding = bindClass(source, element, 'ready');
    const table = createBindingTable(2);
    const values: unknown[] = [];
    table.bind(0, source, value => values.push(value));
    table.bindExpression(1, [source], () => source.value + '!', value => values.push(value));
    expect(text.textContent).toBe('');
    expect(element.classList.contains('ready')).toBeFalse();
    expect(values).toEqual([undefined, undefined]);
    source.next('ready');
    flush?.();
    expect(text.textContent).toBe('ready');
    expect(element.classList.contains('ready')).toBeTrue();
    expect(values).toEqual([undefined, undefined, 'ready', 'ready!']);
    table.destroy();
    textBinding.destroy();
    classBinding.destroy();
    source.dispose();
  });

  it('keeps pending conditionals, value blocks and collections empty', () => {
    const source = atom<string>();
    const collection = atom<string[]>();
    const host = document.createElement('div');
    const anchors = [0, 1, 2].map(() => document.createComment('sx'));
    host.append(...anchors);
    const conditional = ɵcreateSxConditionalBlock(anchors[0], [
      { source, factory: () => block('truthy') },
      { source: null, factory: () => block('pending') },
    ]);
    const valueBlock = ɵcreateSxValueBlock(anchors[1], source, { create: value => block(value) });
    const list = ɵcreateSxKeyedBlock(anchors[2], collection, { create: value => block(value) }, (_, value) => value);
    expect(host.textContent).toBe('pending');
    source.next('ready');
    collection.next(['item']);
    flush?.();
    expect(host.textContent).toBe('truthyreadyitem');
    conditional.destroy();
    valueBlock.destroy();
    list.destroy();
    source.dispose();
    collection.dispose();
  });

  it('does not evaluate a conditional expression with pending dependencies', () => {
    const source = atom<number>();
    const read = jasmine.createSpy('read').and.callFake(() => source.value + 1 > 0);
    const host = document.createElement('div');
    const anchor = document.createComment('sx');
    host.append(anchor);
    const conditional = ɵcreateSxConditionalBlock(anchor, [
      { source: { sources: [source], read }, factory: () => block('ready') },
      { source: null, factory: () => block('pending') },
    ]);
    expect(host.textContent).toBe('pending');
    expect(read).not.toHaveBeenCalled();
    source.next(1);
    flush?.();
    expect(host.textContent).toBe('ready');
    conditional.destroy();
    source.dispose();
  });

  it('keeps server text empty until a delayed flow emits', async () => {
    let release!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>(resolve => release = resolve);
    const done = new Promise<void>(resolve => finish = resolve);
    const source = flow(async function* () { await ready; yield 'ready'; await done; });
    const host = document.createElement('div');
    host.innerHTML = '<output></output>';
    const output = host.firstChild!;
    const binding = bindText(source, output);
    expect(host.innerHTML).toBe('<output></output>');
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    flush?.();
    expect(host.innerHTML).toBe('<output>ready</output>');
    expect(host.firstChild).toBe(output);
    binding.destroy();
    source.dispose();
    finish();
  });
});
