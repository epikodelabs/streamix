import {
  Directive,
  EmbeddedViewRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
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

type AtomTrackByFunction<T> = (index: number, item: T) => unknown;

interface AtomContext<T = unknown> {
  $implicit: T;
  sxAtom: T;
  sxAtomOf?: readonly T[];
  index: number;
  count: number;
  first: boolean;
  last: boolean;
  even: boolean;
  odd: boolean;
}

interface CollectionView<T> {
  key: unknown;
  viewRef: EmbeddedViewRef<AtomContext<T>>;
}

type PendingRender<T> =
  | { kind: 'value'; value: T | undefined }
  | { kind: 'collection'; value: Iterable<T> | undefined };

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
 * lower `*sxAtom` templates to those primitives.
 *
 * @example
 * ```html
 * <ng-container *sxAtom="count as count">{{ count }}</ng-container>
 * <li *sxAtom="let hero of heroes; trackBy: trackHero">{{ hero.name }}</li>
 * ```
 */
@Directive({
  selector: '[sxAtom]',
  standalone: true,
})
export class SxAtomDirective<T = unknown> implements OnChanges, OnDestroy {
  private readonly templateRef =
    inject<TemplateRef<AtomContext<T>>>(TemplateRef);
  private readonly viewContainerRef = inject(ViewContainerRef);

  private unsubscribe?: Subscription;
  private scheduledRender?: ScheduledBinding;
  private pendingRender?: PendingRender<T>;
  private destroyed = false;

  private valueViewRef?: EmbeddedViewRef<AtomContext<T>>;
  private renderedValue: unknown = UNSET;

  private collectionViews: CollectionView<T>[] = [];

  @Input()
  sxAtom: AtomInput<T> | null | undefined;

  @Input()
  sxAtomOf: AtomInput<Iterable<T>> | null | undefined;

  @Input()
  sxAtomTrackBy?: AtomTrackByFunction<T>;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sxAtom'] && !changes['sxAtomOf'] && !changes['sxAtomTrackBy']) {
      return;
    }

    if (this.sxAtomOf !== undefined && this.sxAtomOf !== null) {
      this.bindCollection(this.sxAtomOf);
      return;
    }

    this.bindValue(this.sxAtom);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.unbind();
    this.clearAllViews();
  }

  private bindValue(source: AtomInput<T> | null | undefined): void {
    this.unbind();
    this.clearCollectionViews();

    if (isDependencySource<T>(source)) {
      this.renderValue(source.value);

      this.unsubscribe = source.subscribe((value) => {
        this.schedule({ kind: 'value', value });
      });

      return;
    }

    this.renderValue(source === null ? undefined : source);
  }

  private bindCollection(
    source: AtomInput<Iterable<T>> | null | undefined,
  ): void {
    this.unbind();
    this.clearValueView();

    if (isDependencySource<Iterable<T>>(source)) {
      this.renderCollection(source.value);

      this.unsubscribe = source.subscribe((value) => {
        this.schedule({ kind: 'collection', value });
      });

      return;
    }

    this.renderCollection(source === null ? undefined : source);
  }

  private schedule(render: PendingRender<T>): void {
    this.pendingRender = render;

    if (this.destroyed) {
      return;
    }

    if (!this.scheduledRender) {
      this.scheduledRender = rendererScheduler.register(() => {
        const pending = this.pendingRender;
        this.pendingRender = undefined;

        if (!pending || this.destroyed) {
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
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    this.scheduledRender?.destroy();
    this.scheduledRender = undefined;
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
      this.valueViewRef = this.viewContainerRef.createEmbeddedView(
        this.templateRef,
        createValueContext(value),
      );
      return;
    }

    const context = this.valueViewRef.context;
    context.$implicit = value;
    context.sxAtom = value;
    this.valueViewRef.detectChanges();
  }

  private renderCollection(source: Iterable<T> | undefined): void {
    if (source === undefined) {
      this.clearCollectionViews();
      return;
    }

    const items = Array.isArray(source) ? source : Array.from(source);
    const count = items.length;
    const trackBy = this.sxAtomTrackBy ?? identityTrackBy;

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
      const key = trackBy(index, item);
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
    _directive: SxAtomDirective<T>,
    _context: unknown,
  ): _context is AtomContext<T> {
    return true;
  }
}

type AtomInput<T> = DependencySource<T> | T;

const UNSET = Symbol('streamix.angular.sxAtom.unset');

function identityTrackBy<T>(_index: number, item: T): unknown {
  return item;
}

function createValueContext<T>(value: T): AtomContext<T> {
  return {
    $implicit: value,
    sxAtom: value,
    sxAtomOf: undefined,
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
): AtomContext<T> {
  return {
    $implicit: item,
    sxAtom: item,
    sxAtomOf: items,
    index,
    count,
    first: index === 0,
    last: index === count - 1,
    even: index % 2 === 0,
    odd: index % 2 !== 0,
  };
}

function updateCollectionContext<T>(
  viewRef: EmbeddedViewRef<AtomContext<T>>,
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
    context.sxAtomOf !== items ||
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
  context.sxAtom = item;
  context.sxAtomOf = items;
  context.index = index;
  context.count = count;
  context.first = first;
  context.last = last;
  context.even = even;
  context.odd = odd;

  viewRef.detectChanges();
}

function isDependencySource<T>(
  value: AtomInput<T> | null | undefined,
): value is DependencySource<T> {
  return !!value &&
    typeof value === 'object' &&
    'subscribe' in value &&
    'value' in value &&
    typeof value.subscribe === 'function';
}
