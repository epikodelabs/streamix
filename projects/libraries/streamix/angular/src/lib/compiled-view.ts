import {
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';

import type {
  SxBindingTable,
} from './binding-table';

export type SxCompiledViewSetup<T> = (
  host: Element,
  context: T,
) => SxBindingTable;

/**
 * Installs a compiler-generated sx binding table for the current component.
 *
 * Intended for generated code. It uses only public Angular lifecycle APIs:
 *
 * - setup is deferred until the component DOM exists;
 * - the returned binding table is destroyed with the component;
 * - Angular change detection is not involved in subsequent sx updates.
 *
 * @internal
 */
export function ɵinstallSxCompiledView<T>(
  context: T,
  setup: SxCompiledViewSetup<T>,
): void {
  const host = inject<ElementRef<Element>>(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);

  let table: SxBindingTable | undefined;
  let destroyed = false;

  afterNextRender(() => {
    if (destroyed) {
      return;
    }

    table = setup(host, context);
  });

  destroyRef.onDestroy(() => {
    destroyed = true;
    table?.destroy();
    table = undefined;
  });
}
