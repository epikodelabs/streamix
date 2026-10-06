import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import {
  TestBed,
} from '@angular/core/testing';
import { atom } from '@epikodelabs/streamix';

import {
  createBindingTable,
  rendererScheduler,
  ɵcreateSxCompiledBlock,
  ɵcreateSxConditionalBlock,
  ɵcreateSxKeyedBlock,
  ɵinstallSxCompiledView,
  ɵsxBlockAnchor,
  ɵsxReadLocal,
  ɵsxString,
  ɵsxTextNode,
} from '../lib';

import { idescribe } from '../../../src/tests/env.spec';
import {
  ensureAngularTestEnvironment,
  useAngularTestEnvironment,
} from './angular-test-environment';

ensureAngularTestEnvironment();

/**
 * Mirrors the shape `emit-component-setup` produces for a lowered
 * `@if (model.ready) { <strong class="msg">{{ model.message }}</strong> }
 *  @else { <em>off</em> }` block.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div class="slot"><span data-sx-block="0"></span></div>',
})
class ControlFlowHostComponent {
  readonly ready = atom(false);
  readonly message = atom('hello');

  readonly ɵsx = ɵinstallSxCompiledView(
    this,
    (host: Element, ctx: ControlFlowHostComponent, server = false) => {
      const table = createBindingTable(0);
      const marker0 = host.children[0].children[0] as Element;
      const anchor0 = ɵsxBlockAnchor(marker0, 'sx:0', server);

      const block0 = ɵcreateSxConditionalBlock(anchor0, [
        {
          source: ctx.ready,
          factory: () => {
            const doc = host.ownerDocument!;
            const el0 = doc.createElement('strong');
            el0.setAttribute('class', 'msg');
            const text1 = doc.createTextNode('');
            el0.appendChild(text1);

            const blockTable = createBindingTable(1);
            ɵsxTextNode(blockTable, 0, el0, ctx.message);

            return {
              first: el0,
              last: el0,
              destroy() {
                blockTable.destroy();
              },
            };
          },
        },
        {
          source: null,
          factory: () => {
            const doc = host.ownerDocument!;
            const el2 = doc.createElement('em');
            el2.appendChild(doc.createTextNode('off'));

            return {
              first: el2,
              last: el2,
              destroy() {},
            };
          },
        },
      ]);

      return {
        destroy() {
          table.destroy();
          block0.destroy();
        },
      };
    },
  );
}

/**
 * Mirrors the emitted shape for a lowered
 * `@for (item of model.items; track item.id) { <li>{{ item.name }}</li> }
 *  @empty { <li>none</li> }` block.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ul><span data-sx-block="0"></span></ul>',
})
class CollectionHostComponent {
  readonly items = atom<{ id: number; name: string }[] | undefined>([
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
  ]);

  readonly ɵsx = ɵinstallSxCompiledView(
    this,
    (host: Element, ctx: CollectionHostComponent, server = false) => {
      const table = createBindingTable(0);
      const marker0 = host.children[0].children[0] as Element;
      const anchor0 = ɵsxBlockAnchor(marker0, 'sx:0', server);

      const block0 = ɵcreateSxKeyedBlock(
        anchor0,
        ctx.items,
        {
          create(item, index) {
            const doc = host.ownerDocument!;
            const el0 = doc.createElement('li');
            const text1 = doc.createTextNode('');
            el0.appendChild(text1);

            return ɵcreateSxCompiledBlock(
              el0,
              el0,
              (context) => {
                text1.data = ɵsxString(ɵsxReadLocal(context, 'item.name'));
              },
              { item, index, $index: index },
            );
          },
          update(instance, item, index) {
            instance.update({ item, index, $index: index });
          },
        },
        (_index, item) => item.id,
        () => {
          const doc = host.ownerDocument!;
          const el2 = doc.createElement('li');
          el2.appendChild(doc.createTextNode('none'));

          return {
            first: el2,
            last: el2,
            destroy() {},
          };
        },
      );

      return {
        destroy() {
          table.destroy();
          block0.destroy();
        },
      };
    },
  );
}

idescribe('compiled control flow', () => {
  useAngularTestEnvironment();

  it('renders, swaps and updates branches with no change detection', async () => {
    const fixture = TestBed.createComponent(ControlFlowHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;

    expect(host.querySelector('em')?.textContent).toBe('off');

    // From here on the DOM must update without any detectChanges() call.
    component.ready.next(true);
    rendererScheduler.flushNow();

    expect(host.querySelector('strong.msg')?.textContent).toBe('hello');
    expect(host.querySelector('em')).toBeNull();

    component.message.next('world');
    rendererScheduler.flushNow();

    expect(host.querySelector('strong.msg')?.textContent).toBe('world');

    component.ready.next(false);
    rendererScheduler.flushNow();

    expect(host.querySelector('strong')).toBeNull();
    expect(host.querySelector('em')?.textContent).toBe('off');

    fixture.destroy();
  });

  it('reorders, updates and empties a keyed collection with no change detection', async () => {
    const fixture = TestBed.createComponent(CollectionHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;

    const initial = Array.from(host.querySelectorAll('li'));
    expect(initial.map(node => node.textContent)).toEqual(['A', 'B']);

    // Keyed reorder: item 2 moves to the front and its element is reused.
    component.items.next([{ id: 2, name: 'B' }, { id: 1, name: 'A' }]);
    rendererScheduler.flushNow();

    const reordered = Array.from(host.querySelectorAll('li'));
    expect(reordered.map(node => node.textContent)).toEqual(['B', 'A']);
    expect(reordered[0]).toBe(initial[1]);
    expect(reordered[1]).toBe(initial[0]);

    // Context refresh on a reused record, still without detectChanges().
    component.items.next([{ id: 2, name: 'B2' }, { id: 1, name: 'A' }]);
    rendererScheduler.flushNow();

    expect(reordered[0].textContent).toBe('B2');

    component.items.next([]);
    rendererScheduler.flushNow();

    expect(host.querySelectorAll('li').length).toBe(1);
    expect(host.querySelector('li')?.textContent).toBe('none');

    component.items.next([{ id: 3, name: 'C' }]);
    rendererScheduler.flushNow();

    expect(host.querySelectorAll('li').length).toBe(1);
    expect(host.querySelector('li')?.textContent).toBe('C');

    fixture.destroy();

    expect(host.querySelectorAll('li').length).toBe(0);
  });

});
