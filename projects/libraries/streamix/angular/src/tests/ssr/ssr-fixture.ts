import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import { atom } from '@epikodelabs/streamix';

import {
  createBindingTable,
  ɵcreateSxCompiledBlock,
  ɵcreateSxConditionalBlock,
  ɵcreateSxKeyedBlock,
  ɵinstallSxCompiledView,
  ɵsxBlockAnchor,
  ɵsxListener,
  ɵsxProperty,
  ɵsxReadLocal,
  ɵsxRestoreBlockMarker,
  ɵsxTextExpression,
  ɵsxTextNode,
} from '../../lib';

/**
 * Mirrors the emitted shape for a component whose template is
 *
 *   <div><span data-sx-block="0"></span></div>
 *   <ul><span data-sx-block="1"></span></ul>
 *   <input [value]="message"> <button (click)="onClick()">click</button>
 *
 * with `@if (ready)` and `@for (row of rows; track row.id)` compiled blocks.
 * Written by hand so the server and browser bundles share one fixture.
 */
@Component({
  selector: 'sx-ssr-fixture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="slot"><span data-sx-block="0" data-slot="if"></span></div>
    <ul class="rows"><span data-sx-block="1" data-slot="for"></span></ul>
    <input>
    <button type="button">click</button>
  `,
})
export class SsrFixtureComponent implements AfterViewInit {
  readonly ready = atom(true);
  readonly message = atom('hello');
  readonly rows = atom<{ id: number }[]>([{ id: 1 }, { id: 2 }]);

  clicks = 0;

  onClick(): void {
    this.clicks += 1;
  }

  readonly ɵsx = ɵinstallSxCompiledView(
    this,
    (host: Element, ctx: SsrFixtureComponent, server = false) => {
      const table = createBindingTable(3);
      const doc = host.ownerDocument!;
      const markers = host.querySelectorAll('[data-sx-block]');
      const marker0 = markers[0] as Element;
      const marker1 = markers[1] as Element;
      const anchor0 = ɵsxBlockAnchor(marker0, 'sx:0', server);
      const anchor1 = ɵsxBlockAnchor(marker1, 'sx:1', server);

      // Server rendering keeps the marker empty: the client's template
      // declares an empty marker, so block content rendered inside it would
      // make hydration mismatch.
      const block0 = server ? undefined : ɵcreateSxConditionalBlock(anchor0, [
        {
          source: ctx.ready,
          factory: () => {
            const el0 = doc.createElement('strong');
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
            const el1 = doc.createElement('em');
            el1.appendChild(doc.createTextNode('waiting'));

            return { first: el1, last: el1, destroy() {} };
          },
        },
      ]);

      const block1 = server ? undefined : ɵcreateSxKeyedBlock(
        anchor1,
        ctx.rows,
        {
          create(row, index) {
            let currentContext: Record<string, unknown> = { row, index };
            const el0 = doc.createElement('li');
            const text0 = doc.createTextNode('');
            el0.appendChild(text0);

            const blockTable = createBindingTable(1);
            ɵsxTextExpression(
              blockTable,
              0,
              text0,
              [],
              () => String(ɵsxReadLocal(currentContext, 'row.id')),
            );

            return ɵcreateSxCompiledBlock(
              el0,
              el0,
              (context) => {
                currentContext = context;
              },
              currentContext,
              () => {
                blockTable.destroy();
              },
            );
          },
          update(instance, row, index) {
            instance.update({ row, index });
          },
        },
        (_index: any, row: any) => row.id,
      );

      const input = host.querySelector('input') as HTMLInputElement;
      const button = host.querySelector('button') as HTMLButtonElement;

      ɵsxProperty(table, 0, input, 'value', ctx.message);
      ɵsxListener(
        table,
        1,
        input,
        'input',
        (event: any) => {
          ctx.message.set(event.target.value);
        },
        undefined,
        server,
      );
      ɵsxListener(
        table,
        2,
        button,
        'click',
        () => {
          ctx.onClick();
        },
        undefined,
        server,
      );

      return {
        ɵrestoreMarkers() {
          ɵsxRestoreBlockMarker(anchor0, marker0);
          ɵsxRestoreBlockMarker(anchor1, marker1);
        },
        destroy() {
          table.destroy();
          block0?.destroy();
          block1?.destroy();
        },
      };
    },
  );

  ngAfterViewInit(): void {
    // `afterNextRender` is a no-op under `ngServerMode`, so the generated
    // install mounts from this hook when rendering on the server.
    this.ɵsx.ɵafterViewInit();
  }
}
