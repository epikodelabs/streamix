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
  /**
   * Puts the compiled blocks' marker elements back, so a rebind re-resolves
   * the template's original element paths. Only a rebind needs this: during
   * final teardown the view is going away, and mutating its DOM there can
   * upset Angular's own destroy pass.
   */
  ɵrestoreMarkers?(): void;
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
 * Template positions Angular still evaluates (nothing lowered, sanitizer
 * sinks, plain component state) are rendered by Angular through the SSR
 * fallbacks the compiler writes. Any reactive read in such a position is a
 * build error, so there is nothing to refresh. The runtime never resolves
 * `ChangeDetectorRef` and never writes an Angular signal.
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
    // invalidated before the new source is read and subscribed. The markers
    // come back before the remount re-resolves their element paths.
    previous?.destroy();
    previous?.ɵrestoreMarkers?.();
    mount();
  };

  const start = (): void => {
    // Mounting twice would render every compiled block a second time: the
    // server hook and the first client render can both reach this path when
    // the platform does not set `ngServerMode` (a plain server TestBed, for
    // example).
    if (destroyed || mounted) {
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
