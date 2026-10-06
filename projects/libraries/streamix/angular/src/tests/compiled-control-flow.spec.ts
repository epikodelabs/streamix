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
  ɵsxListener,
  ɵsxProperty,
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

/**
 * Mirrors the emitted shape for a lowered `@if (count > limit) { <strong>over</strong> }
 *  @else { <em>under</em> }` block: one compiled expression over two atoms.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div class="slot"><span data-sx-block="0"></span></div>',
})
class ExpressionHostComponent {
  readonly count = atom(0);
  readonly limit = atom(5);

  readonly ɵsx = ɵinstallSxCompiledView(
    this,
    (host: Element, ctx: ExpressionHostComponent, server = false) => {
      const table = createBindingTable(0);
      const marker0 = host.children[0].children[0] as Element;
      const anchor0 = ɵsxBlockAnchor(marker0, 'sx:0', server);

      const block0 = ɵcreateSxConditionalBlock(anchor0, [
        {
          source: {
            sources: [ctx.count, ctx.limit],
            read: () => ctx.count.value > ctx.limit.value,
          },
          factory: () => {
            const doc = host.ownerDocument!;
            const el0 = doc.createElement('strong');
            el0.appendChild(doc.createTextNode('over'));

            return {
              first: el0,
              last: el0,
              destroy() {},
            };
          },
        },
        {
          source: null,
          factory: () => {
            const doc = host.ownerDocument!;
            const el1 = doc.createElement('em');
            el1.appendChild(doc.createTextNode('under'));

            return {
              first: el1,
              last: el1,
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
 * Mirrors the emitted shape for
 * `@for (row of rows; track row.id) { <li>@if (row.done) { <s>{{ row.name }}</s> }</li> }`:
 * a nested conditional whose condition reads the loop context, refreshed by
 * the enclosing update with no change detection.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ul><span data-sx-block="0"></span></ul>',
})
class NestedHostComponent {
  readonly rows = atom<{ id: number; name: string; done: boolean }[]>([
    { id: 1, name: 'A', done: false },
    { id: 2, name: 'B', done: true },
  ]);

  readonly ɵsx = ɵinstallSxCompiledView(
    this,
    (host: Element, ctx: NestedHostComponent, server = false) => {
      const table = createBindingTable(0);
      const marker0 = host.children[0].children[0] as Element;
      const anchor0 = ɵsxBlockAnchor(marker0, 'sx:0', server);
      const locals = (row: unknown, index: number, count: number) => ({
        row,
        index,
        $index: index,
        count,
        $count: count,
      });

      const block0 = ɵcreateSxKeyedBlock(
        anchor0,
        ctx.rows,
        {
          create(row, index, count) {
            const doc = host.ownerDocument!;
            let currentContext: Record<string, unknown> = locals(row, index, count);
            const el0 = doc.createElement('li');
            const anchor1 = doc.createComment('sx');
            el0.appendChild(anchor1);
            const tail = doc.createTextNode('');
            el0.appendChild(tail);

            const block1 = ɵcreateSxConditionalBlock(anchor1, [
              {
                source: {
                  sources: [],
                  read: () => ɵsxReadLocal(currentContext, 'row.done'),
                },
                factory: () => {
                  const node = doc.createElement('s');
                  node.textContent = String(ɵsxReadLocal(currentContext, 'row.name'));
                  return { first: node, last: node, destroy() {} };
                },
              },
              {
                source: null,
                factory: () => {
                  const node = doc.createElement('em');
                  node.textContent = 'pending';
                  return { first: node, last: node, destroy() {} };
                },
              },
            ]);

            // The nested anchor and tail live inside the item element, so the
            // instance range is just that element.
            return ɵcreateSxCompiledBlock(
              el0,
              el0,
              (context) => {
                currentContext = context;
                block1.refresh();
              },
              currentContext,
            );
          },
          update(instance, row, index, count) {
            instance.update(locals(row, index, count));
          },
        },
        (_index, row) => row.id,
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

/**
 * Mirrors the emitted shape for
 * `@for (row of rows; track row.id) { <li><button (click)="select(row.id)">{{ row.id }}</button></li> }`:
 * one listener per item whose argument reads that item's loop context.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ul><span data-sx-block="0"></span></ul>',
})
class EventHostComponent {
  readonly rows = atom<{ id: number }[]>([{ id: 1 }, { id: 2 }]);
  readonly selected: number[] = [];

  select(id: number): void {
    this.selected.push(id);
  }

  readonly ɵsx = ɵinstallSxCompiledView(
    this,
    (host: Element, ctx: EventHostComponent, server = false) => {
      const anchor0 = ɵsxBlockAnchor(
        host.children[0].children[0] as Element,
        'sx:0',
        server,
      );

      const block0 = ɵcreateSxKeyedBlock(
        anchor0,
        ctx.rows,
        {
          create(row, index) {
            const doc = host.ownerDocument!;
            let currentContext: Record<string, unknown> = { row, index };
            const el0 = doc.createElement('li');
            const el1 = doc.createElement('button');
            el1.textContent = String(row.id);
            el0.appendChild(el1);

            const table = createBindingTable(1);
            ɵsxListener(
              table,
              0,
              el1,
              'click',
              () => {
                ctx.select(ɵsxReadLocal(currentContext, 'row.id') as number);
              },
              undefined,
              server,
            );

            return ɵcreateSxCompiledBlock(
              el0,
              el0,
              (context) => {
                currentContext = context;
              },
              currentContext,
              () => {
                table.destroy();
              },
            );
          },
          update(instance, row, index) {
            instance.update({ row, index });
          },
        },
        (_index, row) => row.id,
      );

      return {
        destroy() {
          block0.destroy();
        },
      };
    },
  );
}

/**
 * Mirrors the emitted shape for `<input [(value)]="name">`: a property
 * binding for the read direction and an input listener writing back.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<input>',
})
class TwoWayHostComponent {
  readonly name = atom('a');

  readonly ɵsx = ɵinstallSxCompiledView(
    this,
    (host: Element, ctx: TwoWayHostComponent) => {
      const table = createBindingTable(2);
      const input = host.children[0] as HTMLInputElement;

      ɵsxProperty(table, 0, input, 'value', ctx.name);
      ɵsxListener(
        table,
        1,
        input,
        'input',
        (event: any) => {
          ctx.name.set(event.target.value);
        },
        undefined,
        false,
      );

      return table;
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

  it('swaps an expression branch when either source emits, with no change detection', async () => {
    const fixture = TestBed.createComponent(ExpressionHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;

    expect(host.querySelector('em')?.textContent).toBe('under');

    component.count.next(9);
    rendererScheduler.flushNow();

    expect(host.querySelector('strong')?.textContent).toBe('over');
    expect(host.querySelector('em')).toBeNull();

    // The second source decides the branch again.
    component.limit.next(20);
    rendererScheduler.flushNow();

    expect(host.querySelector('em')?.textContent).toBe('under');
    expect(host.querySelector('strong')).toBeNull();

    fixture.destroy();
  });

  it('refreshes a nested @if when its loop item changes, with no change detection', async () => {
    const errors = spyOn(console, 'error');
    const fixture = TestBed.createComponent(NestedHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;

    expect(host.querySelectorAll('li').length).toBe(2);
    expect(host.querySelector('li s')?.textContent).toBe('B');
    expect(host.querySelectorAll('em').length).toBe(1);

    // A reused record whose item changed re-evaluates the nested condition.
    component.rows.next([
      { id: 1, name: 'A2', done: true },
      { id: 2, name: 'B', done: false },
    ]);
    rendererScheduler.flushNow();

    const items = Array.from(host.querySelectorAll('li'));
    expect(items[0].querySelector('s')?.textContent).toBe('A2');
    expect(items[1].querySelector('em')?.textContent).toBe('pending');

    // Reordering keeps each nested state with its keyed record.
    component.rows.next([
      { id: 2, name: 'B', done: false },
      { id: 1, name: 'A2', done: true },
    ]);
    rendererScheduler.flushNow();

    const reordered = Array.from(host.querySelectorAll('li'));
    expect(reordered[0].querySelector('em')?.textContent).toBe('pending');
    expect(reordered[1].querySelector('s')?.textContent).toBe('A2');

    // Emptying the collection destroys every nested block with its item.
    component.rows.next([]);
    rendererScheduler.flushNow();

    expect(host.querySelectorAll('li').length).toBe(0);
    expect(host.querySelector('em')).toBeNull();

    fixture.destroy();
    expect(errors).not.toHaveBeenCalled();
  });

  it('runs per-item listeners with the current loop context', async () => {
    const fixture = TestBed.createComponent(EventHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;
    const buttons = Array.from(host.querySelectorAll('button'));

    buttons[1].click();
    expect(component.selected).toEqual([2]);

    // A reused record reports the item it now holds, not the one it was
    // created with.
    component.rows.next([{ id: 2 }, { id: 1 }]);
    rendererScheduler.flushNow();

    const reordered = Array.from(host.querySelectorAll('button'));
    reordered[0].click();
    expect(component.selected).toEqual([2, 2]);

    reordered[1].click();
    expect(component.selected).toEqual([2, 2, 1]);

    fixture.destroy();

    // Destroying the records removed their listeners.
    buttons[1].click();
    expect(component.selected).toEqual([2, 2, 1]);
  });

  it('round-trips a two-way binding without change detection', async () => {
    const fixture = TestBed.createComponent(TwoWayHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector('input') as HTMLInputElement;
    const component = fixture.componentInstance;

    expect(input.value).toBe('a');

    // Atom -> DOM.
    component.name.set('b');
    rendererScheduler.flushNow();

    expect(input.value).toBe('b');

    // DOM -> atom.
    input.value = 'c';
    input.dispatchEvent(new Event('input'));

    expect(component.name.value).toBe('c');

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
