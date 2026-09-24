import {
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';

/**
 * Teardown returned by a compiler-generated sx setup.
 *
 * `SxBindingTable` satisfies this contract, as does the `{ destroy() {} }`
 * object emitted for compiled structural blocks.
 */
export interface SxTeardown {
  destroy(): void;
}

export type SxCompiledViewSetup<T> = (
  host: Element,
  context: T,
) => SxTeardown;

/**
 * Installs a compiler-generated sx setup for the current component.
 *
 * Intended for generated code. It uses only public Angular lifecycle APIs:
 *
 * - setup is deferred until the component DOM exists;
 * - the returned teardown handle is destroyed with the component;
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

  let teardown: SxTeardown | undefined;
  let destroyed = false;

  afterNextRender(() => {
    if (destroyed) {
      return;
    }

    teardown = setup(host, context);
  });

  destroyRef.onDestroy(() => {
    destroyed = true;
    teardown?.destroy();
    teardown = undefined;
  });
}
