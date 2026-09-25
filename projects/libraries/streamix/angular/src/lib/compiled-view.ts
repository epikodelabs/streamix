import {
  ChangeDetectorRef,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';
import type {
  Subscription,
} from '@epikodelabs/streamix';

import type {
  SxSourceReferenceMap,
} from './source-reference';

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
 * Compiler-owned runtime options for a compiled Streamix view.
 *
 * `sourceReferences` carries per-component field identity notifications from
 * the compiler-generated source-reference bridge. A changed source identity
 * synchronously tears down and recreates the Streamix setup without asking
 * Angular to run change detection.
 *
 * `angularInvalidation` is emitted only for hybrid expressions that remain
 * Angular-owned. Pure Streamix views therefore do not resolve
 * `ChangeDetectorRef` at all.
 *
 * @internal
 */
export interface SxCompiledViewOptions {
  readonly sourceReferences?: SxSourceReferenceMap;
  readonly angularInvalidation?: boolean;
}

/**
 * Installs a compiler-generated sx setup for the current component.
 *
 * Direct Streamix bindings remain completely outside Angular change detection.
 * Replacing a compiler-selected plain source field is delivered through the
 * source-reference bridge and synchronously rebuilds the Streamix setup.
 *
 * Hybrid expressions (for example `{{ count.value * multiplier }}`) keep their
 * Angular expression semantics. Only those generated views opt into local
 * Angular invalidation and therefore resolve `ChangeDetectorRef`.
 *
 * @internal
 */
export function ɵinstallSxCompiledView<T extends object>(
  context: T,
  setup: SxCompiledViewSetup<T>,
  options: SxCompiledViewOptions = {},
): void {
  const host = inject<ElementRef<Element>>(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);
  const changeDetectorRef = options.angularInvalidation
    ? inject(ChangeDetectorRef)
    : undefined;

  let teardown: SxTeardown | undefined;
  let referenceSubscriptions: Subscription[] = [];
  let mounted = false;
  let destroyed = false;

  const invalidate = changeDetectorRef
    ? () => changeDetectorRef.detectChanges()
    : () => {};

  const mount = (): void => {
    if (destroyed) {
      return;
    }

    teardown = setup(
      host,
      context,
      invalidate,
    );
    mounted = true;
  };

  const rebind = (): void => {
    if (destroyed || !mounted) {
      return;
    }

    const previous = teardown;
    teardown = undefined;
    mounted = false;

    // Destroy first so old subscriptions and any queued renderer work are
    // invalidated before the new source is read and subscribed.
    previous?.destroy();
    mount();
  };

  afterNextRender(() => {
    if (destroyed) {
      return;
    }

    referenceSubscriptions = Object.values(
      options.sourceReferences ?? {},
    ).map(reference => reference.subscribe(rebind));

    mount();
  });

  destroyRef.onDestroy(() => {
    destroyed = true;

    for (const unsubscribe of referenceSubscriptions) {
      unsubscribe();
    }
    referenceSubscriptions = [];

    teardown?.destroy();
    teardown = undefined;
    mounted = false;
  });
}
