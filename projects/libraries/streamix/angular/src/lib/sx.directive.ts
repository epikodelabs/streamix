import {
  Directive,
  EmbeddedViewRef,
  Input,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  inject,
} from '@angular/core';
import type {
  DependencySource,
  Subscription,
} from '@epikodelabs/streamix';

import {
  rendererScheduler,
  type ScheduledBinding,
} from './render-scheduler';
import type {
  SxSourceReference,
} from './source-reference';

export type SxTrackByFunction<T> = (index: number, item: T) => unknown;

export interface SourceContext<T = unknown> {
  $implicit: T;
  sx: T;
  sxOf?: readonly T[];
  index: number;
  count: number;
  first: boolean;
  last: boolean;
  even: boolean;
  odd: boolean;
}

interface CollectionView<T> {
  key: unknown;
  viewRef: EmbeddedViewRef<SourceContext<T>>;
}

type PendingRender<T> =
  | {
      kind: 'value';
      value: T | undefined;
      generation: number;
      source: DependencySource<unknown>;
    }
  | {
      kind: 'collection';
      value: Iterable<T> | undefined;
      generation: number;
      source: DependencySource<unknown>;
    };

/**
 * Angular structural bridge for Streamix-compatible sources.
 *
 * Initial rendering is synchronous. Reactive emissions are coalesced to the
 * next animation frame and collection views are keyed/reused instead of being
 * cleared and recreated.
 *
 * This directive still renders an Angular TemplateRef and therefore uses
 * EmbeddedViewRef.detectChanges(). Truly direct bindings live in the direct
 * renderer primitives such as `bindText` / `sxText`; a future compiler pass can
 * lower `*sx` templates to those primitives.
 *
 * @example
 * ```html
 * <ng-container *sx="count as count">{{ count }}</ng-container>
 * <li *sx="let hero of heroes; trackBy: trackHero">{{ hero.name }}</li>
 * ```
 */
@Directive({
  selector: '[sx]',
  standalone: true,
})
export class SxDirective<T = unknown> implements OnDestroy {
  private readonly templateRef =
    inject<TemplateRef<SourceContext<T>>>(TemplateRef);
  private readonly viewContainerRef = inject(ViewContainerRef);

  private unsubscribe?: Subscription;
  private scheduledRender?: ScheduledBinding;
  private pendingRender?: PendingRender<T>;
  private destroyed = false;
  private bindingGeneration = 0;
  private boundSource?: DependencySource<unknown>;
  private boundMode: 'value' | 'collection' | undefined;
  private boundInput: unknown = UNSET_INPUT;
  private boundTrackBy: SxTrackByFunction<T> | undefined;

  private valueViewRef?: EmbeddedViewRef<SourceContext<T>>;
  private renderedValue: unknown = UNSET;

  private collectionViews: CollectionView<T>[] = [];

  private sxInput: SxMicrosyntaxInput<T> | null | undefined;
  private sxOfInput: SourceInput<Iterable<T>> | null | undefined;
  private sxTrackByInput: SxTrackByFunction<T> | undefined;
  private sourceReferenceUnsubscribe?: Subscription;

  /**
   * Structural directives must reconcile their primary input when Angular
   * writes it. Waiting for a later lifecycle hook leaves a window where a
   * replaced source is still subscribed and an already-queued old emission
   * can render.
   */
  @Input()
  set sx(value: SxMicrosyntaxInput<T> | null | undefined) {
    if (Object.is(this.sxInput, value)) return;
    this.sxInput = value;
    this.reconcileBinding();
  }

  get sx(): SxMicrosyntaxInput<T> | null | undefined {
    return this.sxInput;
  }

  @Input()
  set sxOf(value: SourceInput<Iterable<T>> | null | undefined) {
    if (Object.is(this.sxOfInput, value)) return;
    this.sxOfInput = value;
    this.reconcileBinding();
  }

  get sxOf(): SourceInput<Iterable<T>> | null | undefined {
    return this.sxOfInput;
  }

  @Input()
  set sxTrackBy(value: SxTrackByFunction<T> | undefined) {
    if (this.sxTrackByInput === value) return;
    this.sxTrackByInput = value;
    this.reconcileBinding();
  }

  get sxTrackBy(): SxTrackByFunction<T> | undefined {
    return this.sxTrackByInput;
  }

  /**
   * Compiler-only source-reference channel.
   *
   * Authored templates never need to provide this input. The build transform
   * adds it to simple `*sx` microsyntax so a plain component-field assignment
   * can rebind the directive without Angular change detection.
   *
   * @internal
   */
  @Input()
  set sxSourceRef(reference: SxSourceReference<unknown> | null | undefined) {
    this.sourceReferenceUnsubscribe?.();
    this.sourceReferenceUnsubscribe = undefined;

    if (!reference) {
      return;
    }

    this.sourceReferenceUnsubscribe = reference.subscribe(source => {
      if (this.destroyed) {
        return;
      }

      if (this.boundMode === 'collection' ||
          (this.sxOfInput !== undefined && this.sxOfInput !== null)) {
        this.sxOfInput = source as SourceInput<Iterable<T>>;
      } else {
        this.sxInput = source as SxMicrosyntaxInput<T>;
      }

      this.reconcileBinding();
    });
  }

  private reconcileBinding(): void {
    const collectionMode = this.sxOfInput !== undefined && this.sxOfInput !== null;
    const mode = collectionMode ? 'collection' : 'value';
    const input = collectionMode ? this.sxOfInput : this.sxInput;
    const trackByChanged = collectionMode && this.boundTrackBy !== this.sxTrackByInput;

    if (
      this.boundMode === mode &&
      this.boundInput === input &&
      !trackByChanged
    ) {
      return;
    }

    this.boundMode = mode;
    this.boundInput = input;
    this.boundTrackBy = this.sxTrackByInput;

    if (collectionMode) {
      this.bindCollection(this.sxOfInput);
    } else {
      this.bindValue(this.sxInput);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.sourceReferenceUnsubscribe?.();
    this.sourceReferenceUnsubscribe = undefined;
    this.unbind();
    this.scheduledRender?.destroy();
    this.scheduledRender = undefined;
    this.boundInput = UNSET_INPUT;
    this.boundMode = undefined;
    this.clearAllViews();
  }

  private bindValue(source: SxMicrosyntaxInput<T> | null | undefined): void {
    this.unbind();
    this.clearCollectionViews();
    const generation = this.bindingGeneration;

    if (isDependencySource<T>(source)) {
      this.boundSource = source as DependencySource<unknown>;
      this.renderValue(source.value);

      let subscribing = true;
      this.unsubscribe = source.subscribe((value) => {
        if (this.boundSource !== source || subscribing) {
          return;
        }
        this.schedule({
          kind: 'value',
          value,
          generation,
          source: source as DependencySource<unknown>,
        });
      });
      subscribing = false;

      return;
    }

    this.renderValue(source === null ? undefined : source as T | undefined);
  }

  private bindCollection(
    source: SourceInput<Iterable<T>> | null | undefined,
  ): void {
    this.unbind();
    this.clearValueView();
    const generation = this.bindingGeneration;

    if (isDependencySource<Iterable<T>>(source)) {
      this.boundSource = source as DependencySource<unknown>;
      this.renderCollection(source.value);

      let subscribing = true;
      this.unsubscribe = source.subscribe((value) => {
        if (this.boundSource !== source || subscribing) {
          return;
        }
        this.schedule({
          kind: 'collection',
          value,
          generation,
          source: source as DependencySource<unknown>,
        });
      });
      subscribing = false;

      return;
    }

    this.renderCollection(source === null ? undefined : source);
  }

  private schedule(render: PendingRender<T>): void {
    if (
      this.destroyed ||
      render.generation !== this.bindingGeneration ||
      render.source !== this.boundSource
    ) {
      return;
    }

    this.pendingRender = render;

    if (!this.scheduledRender) {
      this.scheduledRender = rendererScheduler.register(() => {
        const pending = this.pendingRender;
        this.pendingRender = undefined;

        if (
          !pending ||
          this.destroyed ||
          pending.generation !== this.bindingGeneration ||
          pending.source !== this.boundSource
        ) {
          return;
        }

        if (pending.kind === 'value') {
          this.renderValue(pending.value);
        } else {
          this.renderCollection(pending.value);
        }
      });
    }

    this.scheduledRender.markDirty();
  }

  private unbind(): void {
    // Invalidate callbacks that a source may already have queued before its
    // subscription is removed. This prevents stale values from winning after
    // a source replacement.
    this.bindingGeneration += 1;

    this.boundSource = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    // Keep one scheduler binding for the directive lifetime. A source
    // replacement may happen while that binding is already dirty; clearing
    // only the payload means the queued frame becomes a harmless no-op, and a
    // newer source emission can reuse the same dirty slot without depending on
    // scheduler-id destruction/reuse semantics.
    this.pendingRender = undefined;
  }

  private renderValue(value: T | undefined): void {
    if (Object.is(this.renderedValue, value)) {
      return;
    }

    this.renderedValue = value;

    if (value === undefined) {
      this.clearValueView();
      return;
    }

    if (!this.valueViewRef) {
      const viewRef = this.viewContainerRef.createEmbeddedView(
        this.templateRef,
        createValueContext(value),
      );
      this.valueViewRef = viewRef;
      // Reactive callbacks run independently of the parent Angular check. A
      // freshly recreated embedded view therefore needs its first local check
      // immediately; otherwise interpolation DOM stays empty until some later
      // application change-detection pass.
      viewRef.detectChanges();
      return;
    }

    const context = this.valueViewRef.context;
    context.$implicit = value;
    context.sx = value;
    this.valueViewRef.detectChanges();
  }

  private renderCollection(source: Iterable<T> | undefined): void {
    if (source === undefined) {
      this.clearCollectionViews();
      return;
    }

    const items = Array.isArray(source) ? source : Array.from(source);
    const count = items.length;
    const trackBy = this.sxTrackBy ?? identityTrackBy;
    const keys = new Array<unknown>(count);
    const seenKeys = new Set<unknown>();

    // Match the compiled keyed-block contract: keys must be unique within one
    // rendered collection. Validate before touching existing views so a bad
    // update cannot leave the container half-reordered.
    for (let index = 0; index < count; index += 1) {
      const key = trackBy(index, items[index]);
      if (seenKeys.has(key)) {
        throw new Error(`Duplicate sx collection key: ${String(key)}`);
      }
      seenKeys.add(key);
      keys[index] = key;
    }

    const available = new Map<unknown, CollectionView<T>[]>();

    for (const record of this.collectionViews) {
      const bucket = available.get(record.key);

      if (bucket) {
        bucket.push(record);
      } else {
        available.set(record.key, [record]);
      }
    }

    const nextViews: CollectionView<T>[] = [];

    for (let index = 0; index < count; index += 1) {
      const item = items[index];
      const key = keys[index];
      const bucket = available.get(key);
      const record = bucket?.shift();

      if (bucket && bucket.length === 0) {
        available.delete(key);
      }

      if (record) {
        updateCollectionContext(record.viewRef, items, item, index, count);

        const currentIndex = this.viewContainerRef.indexOf(record.viewRef);
        if (currentIndex !== index) {
          this.viewContainerRef.move(record.viewRef, index);
        }

        nextViews.push({ key, viewRef: record.viewRef });
        continue;
      }

      const viewRef = this.viewContainerRef.createEmbeddedView(
        this.templateRef,
        createCollectionContext(items, item, index, count),
        { index },
      );
      viewRef.detectChanges();

      nextViews.push({ key, viewRef });
    }

    for (const bucket of available.values()) {
      for (const record of bucket) {
        const index = this.viewContainerRef.indexOf(record.viewRef);
        if (index >= 0) {
          this.viewContainerRef.remove(index);
        } else {
          record.viewRef.destroy();
        }
      }
    }

    this.collectionViews = nextViews;
  }

  private clearValueView(): void {
    if (!this.valueViewRef) {
      this.renderedValue = UNSET;
      return;
    }

    const index = this.viewContainerRef.indexOf(this.valueViewRef);

    if (index >= 0) {
      this.viewContainerRef.remove(index);
    } else {
      this.valueViewRef.destroy();
    }

    this.valueViewRef = undefined;
    this.renderedValue = UNSET;
  }

  private clearCollectionViews(): void {
    if (this.collectionViews.length === 0) {
      return;
    }

    this.viewContainerRef.clear();
    this.collectionViews = [];
  }

  private clearAllViews(): void {
    this.viewContainerRef.clear();
    this.valueViewRef = undefined;
    this.collectionViews = [];
    this.renderedValue = UNSET;
  }

  static ngTemplateContextGuard<T>(
    _directive: SxDirective<T>,
    _context: unknown,
  ): _context is SourceContext<T> {
    return true;
  }
}

export type SourceInput<T> = DependencySource<T> | T;

/**
 * Angular structural-directive primary input. Collection microsyntax such as
 * `*sx="let item of items"` desugars with an empty-string `sx` marker plus
 * the actual collection expression on `sxOf`. Keep that Angular-only marker
 * out of the framework-agnostic SourceInput<T> contract.
 */
export type SxMicrosyntaxInput<T> = SourceInput<T> | '';

const UNSET = Symbol('streamix.angular.sx.unset');
const UNSET_INPUT = Symbol('streamix.angular.sx.unsetInput');

function identityTrackBy<T>(_index: number, item: T): unknown {
  return item;
}

function createValueContext<T>(value: T): SourceContext<T> {
  return {
    $implicit: value,
    sx: value,
    sxOf: undefined,
    index: 0,
    count: 1,
    first: true,
    last: true,
    even: true,
    odd: false,
  };
}

function createCollectionContext<T>(
  items: readonly T[],
  item: T,
  index: number,
  count: number,
): SourceContext<T> {
  return {
    $implicit: item,
    sx: item,
    sxOf: items,
    index,
    count,
    first: index === 0,
    last: index === count - 1,
    even: index % 2 === 0,
    odd: index % 2 !== 0,
  };
}

function updateCollectionContext<T>(
  viewRef: EmbeddedViewRef<SourceContext<T>>,
  items: readonly T[],
  item: T,
  index: number,
  count: number,
): void {
  const context = viewRef.context;
  const first = index === 0;
  const last = index === count - 1;
  const even = index % 2 === 0;
  const odd = !even;

  const changed =
    !Object.is(context.$implicit, item) ||
    context.sxOf !== items ||
    context.index !== index ||
    context.count !== count ||
    context.first !== first ||
    context.last !== last ||
    context.even !== even ||
    context.odd !== odd;

  if (!changed) {
    return;
  }

  context.$implicit = item;
  context.sx = item;
  context.sxOf = items;
  context.index = index;
  context.count = count;
  context.first = first;
  context.last = last;
  context.even = even;
  context.odd = odd;

  viewRef.detectChanges();
}

function isDependencySource<T>(
  value: unknown,
): value is DependencySource<T> {
  return !!value &&
    typeof value === 'object' &&
    'subscribe' in value &&
    'value' in value &&
    typeof value.subscribe === 'function';
}