import {
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
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
  server?: boolean,
) => SxTeardown;

/**
 * Handle returned by {@link ɵinstallSxCompiledView}.
 *
 * @internal
 */
export interface SxCompiledViewHandle {
  /**
   * Mounts the compiled view during server rendering, where
   * `afterNextRender` is a no-op. The generated component calls this from
   * `ngAfterViewInit`; it does nothing in the browser.
   */
  ɵafterViewInit(): void;
}

/**
 * Compiler-owned runtime options for a compiled Streamix view.
 *
 * `sourceReferences` carries per-component field identity notifications from
 * the compiler-generated source-reference bridge. A changed source identity
 * synchronously tears down and recreates the Streamix setup without asking
 * Angular to run change detection.
 *
 * @internal
 */
export interface SxCompiledViewOptions {
  readonly sourceReferences?: SxSourceReferenceMap;
}

/**
 * Installs a compiler-generated sx setup for the current component.
 *
 * Direct Streamix bindings remain completely outside Angular change detection.
 * Replacing a compiler-selected plain source field is delivered through the
 * source-reference bridge and synchronously rebuilds the Streamix setup.
 *
 * Template positions Angular still evaluates (non-lowered control flow, hybrid
 * expressions, sanitizer sinks) read generated signal accessors, so they
 * refresh through Angular's scheduler. The runtime never resolves
 * `ChangeDetectorRef`.
 *
 * @internal
 */
export function ɵinstallSxCompiledView<T extends object>(
  context: T,
  setup: SxCompiledViewSetup<T>,
  options: SxCompiledViewOptions = {},
): SxCompiledViewHandle {
  const host = inject<ElementRef<Element>>(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);
  const server = inject(PLATFORM_ID) === 'server';

  let teardown: SxTeardown | undefined;
  let referenceSubscriptions: Subscription[] = [];
  let mounted = false;
  let destroyed = false;

  const mount = (): void => {
    if (destroyed) {
      return;
    }

    teardown = setup(
      host,
      context,
      server,
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

  const start = (): void => {
    if (destroyed) {
      return;
    }

    referenceSubscriptions = Object.values(
      options.sourceReferences ?? {},
    ).map(reference => reference.subscribe(rebind));

    mount();
  };

  afterNextRender(() => {
    start();
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

  return {
    ɵafterViewInit(): void {
      if (server) {
        start();
      }
    },
  };
}
