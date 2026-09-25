import {
  ChangeDetectorRef,
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
  invalidate?: () => void,
) => SxTeardown;

/**
 * Installs a compiler-generated sx setup for the current component.
 *
 * Direct Streamix bindings remain completely outside Angular change detection.
 * Hybrid expressions (for example `{{ count.value * multiplier }}`) keep their
 * Angular expression semantics; Streamix emissions trigger a coalesced local
 * `detectChanges()` through the generated invalidation slot.
 *
 * @internal
 */
export function ɵinstallSxCompiledView<T>(
  context: T,
  setup: SxCompiledViewSetup<T>,
): void {
  const host = inject<ElementRef<Element>>(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);
  const changeDetectorRef = inject(ChangeDetectorRef);

  let teardown: SxTeardown | undefined;
  let destroyed = false;

  afterNextRender(() => {
    if (destroyed) {
      return;
    }

    teardown = setup(
      host,
      context,
      () => changeDetectorRef.detectChanges(),
    );
  });

  destroyRef.onDestroy(() => {
    destroyed = true;
    teardown?.destroy();
    teardown = undefined;
  });
}
