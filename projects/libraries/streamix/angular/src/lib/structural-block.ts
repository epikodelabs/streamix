import type {
  DependencySource,
  Subscription,
} from '@epikodelabs/streamix';

import {
  rendererScheduler,
  type ScheduledBinding,
} from './render-scheduler';

export interface SxBlockInstance {
  readonly first: Node;
  readonly last: Node;
  destroy(): void;
}

export interface SxValueBlockFactory<T> {
  create(value: T): SxBlockInstance;
  update?(instance: SxBlockInstance, value: T): void;
}

export interface SxCollectionBlockFactory<T> {
  /** `count` is the current collection length, for `$count`-style context. */
  create(item: T, index: number, count: number): SxBlockInstance;
  update?(
    instance: SxBlockInstance & {
      update(context: Record<string, unknown>): void;
    },
    item: T,
    index: number,
    count: number,
  ): void;
}

export type SxTrackBy<T> = (
  index: number,
  item: T,
) => unknown;

interface CollectionRecord<T> {
  key: unknown;
  item: T;
  instance: SxBlockInstance;
}

const UNSET = Symbol('sx.unset');

export class SxValueBlock<T> {
  private unsubscribe?: Subscription;
  private scheduled?: ScheduledBinding;
  private pending: T | undefined | typeof UNSET = UNSET;
  private instance?: SxBlockInstance;
  private current: T | undefined | typeof UNSET = UNSET;
  private generation = 0;
  private destroyed = false;

  constructor(
    private readonly anchor: Node,
    private readonly factory: SxValueBlockFactory<T>,
  ) {}

  bind(source: DependencySource<T | undefined>): void {
    if (this.destroyed) {
      throw new Error('Cannot bind a destroyed sx value block.');
    }

    this.unbind();
    this.current = UNSET;
    this.render(source.value);

    const generation = ++this.generation;

    let subscribing = true;
    this.unsubscribe = source.subscribe(value => {
      if (generation !== this.generation || subscribing) return;

      this.pending = value;
      this.ensureScheduled(generation);
    });
    subscribing = false;
  }

  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.generation += 1;
    this.unbind();
    this.removeInstance();
    this.current = UNSET;
  }

  private ensureScheduled(generation: number): void {
    if (!this.scheduled) {
      this.scheduled = rendererScheduler.register(() => {
        if (
          this.destroyed ||
          generation !== this.generation ||
          this.pending === UNSET
        ) {
          return;
        }

        const value = this.pending;
        this.pending = UNSET;
        this.render(value);
      });
    }

    this.scheduled.markDirty();
  }

  private render(value: T | undefined): void {
    if (this.destroyed || Object.is(this.current, value)) {
      return;
    }

    this.current = value;

    if (value === undefined) {
      this.removeInstance();
      return;
    }

    if (!this.instance) {
      this.instance = this.factory.create(value);
      moveInstanceAfter(this.anchor, this.instance);
      return;
    }

    this.factory.update?.(this.instance, value);
  }

  private removeInstance(): void {
    if (!this.instance) return;

    removeInstance(this.instance);
    this.instance.destroy();
    this.instance = undefined;
  }

  private unbind(): void {
    this.generation += 1;

    this.unsubscribe?.();
    this.unsubscribe = undefined;

    this.scheduled?.destroy();
    this.scheduled = undefined;

    this.pending = UNSET;
  }
}

export type SxBlockFactory = () => SxBlockInstance;

/**
 * A reactive expression compiled from a template: the sources it reads and a
 * function that evaluates it. Mirrors the binding table's expression contract —
 * evaluated once at setup and at most once per renderer flush.
 */
export interface SxExpression<T> {
  readonly sources: readonly DependencySource<unknown>[];
  readonly read: () => T;
}

export type SxValueOrExpression<T> = DependencySource<T> | SxExpression<T>;

function isSxExpression<T>(
  value: SxValueOrExpression<T>,
): value is SxExpression<T> {
  return typeof (value as SxExpression<T>).read === 'function' &&
    Array.isArray((value as SxExpression<T>).sources);
}

function readSxValue<T>(value: SxValueOrExpression<T>): T {
  return isSxExpression(value) ? value.read() : value.value;
}

function sourcesOf<T>(
  value: SxValueOrExpression<T>,
): readonly DependencySource<unknown>[] {
  return isSxExpression(value)
    ? value.sources
    : [value as DependencySource<unknown>];
}

export interface SxConditionalBranch {
  /**
   * Reactive condition for this branch. `null` marks the `@else`/`@default`
   * branch, which renders when no preceding branch matched.
   */
  readonly source: SxValueOrExpression<unknown> | null;
  /**
   * When present, the branch matches only if the source equals this literal
   * (`@switch` case semantics) instead of testing truthiness.
   */
  readonly match?: unknown;
  readonly factory: SxBlockFactory;
}

/**
 * Renders the first branch whose condition is truthy as direct DOM.
 *
 * There is no Angular view and no change detection involved: a source emission
 * schedules one frame, the winning branch is re-selected, and the rendered
 * branch is swapped in place.
 */
export class SxConditionalBlock {
  private unsubscribes: Subscription[] = [];
  private scheduled?: ScheduledBinding;
  private instance?: SxBlockInstance;
  private current = -1;
  private generation = 0;
  private destroyed = false;

  constructor(
    private readonly anchor: Node,
    private readonly branches: readonly SxConditionalBranch[],
  ) {}

  bind(): void {
    if (this.destroyed) {
      throw new Error('Cannot bind a destroyed sx conditional block.');
    }

    this.unbind();

    const generation = ++this.generation;
    let subscribing = true;

    for (const branch of this.branches) {
      if (!branch.source) {
        continue;
      }

      for (const source of sourcesOf(branch.source)) {
        this.unsubscribes.push(source.subscribe(() => {
          if (generation !== this.generation || subscribing) return;

          this.ensureScheduled(generation);
        }));
      }
    }

    subscribing = false;
    this.render();
  }

  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.generation += 1;
    this.unbind();
    this.removeInstance();
    this.current = -1;
  }

  /**
   * Re-evaluates the branch selection synchronously. Used by a nested block
   * whose condition reads the enclosing loop context, which changes without
   * any source emission.
   */
  refresh(): void {
    if (this.destroyed) {
      return;
    }

    this.render();
  }

  private ensureScheduled(generation: number): void {
    if (!this.scheduled) {
      this.scheduled = rendererScheduler.register(() => {
        if (this.destroyed || generation !== this.generation) {
          return;
        }

        this.render();
      });
    }

    this.scheduled.markDirty();
  }

  private selectIndex(): number {
    for (let index = 0; index < this.branches.length; index += 1) {
      const branch = this.branches[index];

      if (branch.source === null) {
        return index;
      }

      const value = readSxValue(branch.source);

      if (
        branch.match === undefined
          ? value
          : value === branch.match
      ) {
        return index;
      }
    }

    return -1;
  }

  private render(): void {
    if (this.destroyed) return;

    const index = this.selectIndex();

    if (index === this.current) {
      return;
    }

    this.removeInstance();
    this.current = index;

    if (index < 0) {
      return;
    }

    this.instance = this.branches[index].factory();
    moveInstanceAfter(this.anchor, this.instance);
  }

  private removeInstance(): void {
    if (!this.instance) return;

    removeInstance(this.instance);
    this.instance.destroy();
    this.instance = undefined;
  }

  private unbind(): void {
    this.generation += 1;

    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes = [];

    this.scheduled?.destroy();
    this.scheduled = undefined;
  }
}

export class SxKeyedBlock<T> {
  private unsubscribes: Subscription[] = [];
  private scheduled?: ScheduledBinding;
  /**
   * The collection to read at the next flush. The value itself is read then,
   * so an expression over several sources evaluates once per frame.
   */
  private pending?: SxValueOrExpression<Iterable<T> | undefined>;
  /** The bound collection, kept for context-driven refreshes. */
  private bound?: SxValueOrExpression<Iterable<T> | undefined>;
  private records: CollectionRecord<T>[] = [];
  private emptyInstance?: SxBlockInstance;
  private generation = 0;
  private destroyed = false;

  constructor(
    private readonly anchor: Node,
    private readonly factory: SxCollectionBlockFactory<T>,
    private readonly trackBy: SxTrackBy<T>,
    private readonly emptyFactory?: SxBlockFactory,
  ) {}

  bind(source: SxValueOrExpression<Iterable<T> | undefined>): void {
    if (this.destroyed) {
      throw new Error('Cannot bind a destroyed sx keyed block.');
    }

    this.unbind();
    this.bound = source;
    this.render(toArray(readSxValue(source)));

    const generation = ++this.generation;

    let subscribing = true;
    for (const dependency of sourcesOf(source)) {
      this.unsubscribes.push(dependency.subscribe(() => {
        if (generation !== this.generation || subscribing) return;

        this.pending = source;
        this.ensureScheduled(generation);
      }));
    }
    subscribing = false;
  }

  destroy(): void {
    if (this.destroyed) return;

    this.destroyed = true;
    this.generation += 1;
    this.unbind();

    for (const record of this.records) {
      removeInstance(record.instance);
      record.instance.destroy();
    }

    this.records = [];

    if (this.emptyInstance) {
      removeInstance(this.emptyInstance);
      this.emptyInstance.destroy();
      this.emptyInstance = undefined;
    }
  }

  /**
   * Re-reads the collection and re-renders synchronously. Used by a nested
   * block whose expression reads the enclosing loop context.
   */
  refresh(): void {
    if (this.destroyed || this.bound === undefined) {
      return;
    }

    this.render(toArray(readSxValue(this.bound)));
  }

  private removeRecords(): void {
    for (const record of this.records) {
      removeInstance(record.instance);
      record.instance.destroy();
    }

    this.records = [];
  }

  private ensureScheduled(generation: number): void {
    if (!this.scheduled) {
      this.scheduled = rendererScheduler.register(() => {
        if (
          this.destroyed ||
          generation !== this.generation
        ) {
          return;
        }

        const pending = this.pending;
        this.pending = undefined;

        if (pending === undefined) {
          return;
        }

        this.render(toArray(readSxValue(pending)));
      });
    }

    this.scheduled.markDirty();
  }

  private render(items: readonly T[]): void {
    if (this.destroyed) return;

    assertUniqueKeys(items, this.trackBy);

    if (items.length === 0 && this.emptyFactory) {
      this.removeRecords();

      if (!this.emptyInstance) {
        this.emptyInstance = this.emptyFactory();
        moveInstanceAfter(this.anchor, this.emptyInstance);
      }

      return;
    }

    if (this.emptyInstance) {
      removeInstance(this.emptyInstance);
      this.emptyInstance.destroy();
      this.emptyInstance = undefined;
    }

    const available = new Map<unknown, CollectionRecord<T>>();

    for (const record of this.records) {
      available.set(record.key, record);
    }

    const next: CollectionRecord<T>[] = [];
    let cursor: Node = this.anchor;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const key = this.trackBy(index, item);
      let record = available.get(key);

      if (record) {
        available.delete(key);
        record.item = item;
        this.factory.update?.(
          // Compiler-generated factories always create an updatable instance;
          // the base interface only guarantees the block range contract.
          record.instance as SxBlockInstance & {
            update(context: Record<string, unknown>): void;
          },
          item,
          index,
          items.length,
        );
      } else {
        record = {
          key,
          item,
          instance: this.factory.create(item, index, items.length),
        };
      }

      moveInstanceAfter(cursor, record.instance);
      cursor = record.instance.last;
      next.push(record);
    }

    for (const record of available.values()) {
      removeInstance(record.instance);
      record.instance.destroy();
    }

    this.records = next;
  }

  private unbind(): void {
    this.generation += 1;

    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes = [];

    this.scheduled?.destroy();
    this.scheduled = undefined;

    this.pending = undefined;
    this.bound = undefined;
  }
}

export function ɵcreateSxValueBlock<T>(
  anchor: Node,
  source: DependencySource<T | undefined>,
  factory: SxValueBlockFactory<T>,
): SxValueBlock<T> {
  const block = new SxValueBlock(anchor, factory);
  block.bind(source);
  return block;
}

export function ɵcreateSxConditionalBlock(
  anchor: Node,
  branches: readonly SxConditionalBranch[],
): SxConditionalBlock {
  const block = new SxConditionalBlock(anchor, branches);
  block.bind();
  return block;
}

/**
 * Resolves the anchor for a lowered structural block.
 *
 * During server rendering the marker element is kept and the block renders
 * inside it, so the server HTML still contains the block content and client
 * hydration finds the template's element in place. In the browser the marker is
 * replaced by a comment anchor, which keeps CSS selectors such as
 * `ul > li`/`:first-child` intact.
 *
 * @internal
 */
export function ɵsxBlockAnchor(
  marker: Element,
  label: string,
  server = false,
): Node {
  if (server) {
    return marker;
  }

  const anchor = marker.ownerDocument!.createComment(label);
  marker.parentNode!.replaceChild(anchor, marker);
  return anchor;
}

/**
 * Puts the marker element back when a compiled view is torn down, so a rebind
 * re-resolves the template's original element paths. Replacing the marker with
 * an anchor shifts the element indices of every later sibling.
 *
 * @internal
 */
export function ɵsxRestoreBlockMarker(anchor: Node, marker: Element): void {
  if (anchor === marker || !anchor.parentNode) {
    return;
  }

  anchor.parentNode.replaceChild(marker, anchor);
}

export function ɵcreateSxKeyedBlock<T>(
  anchor: Node,
  source: SxValueOrExpression<Iterable<T> | undefined>,
  factory: SxCollectionBlockFactory<T>,
  trackBy: SxTrackBy<T> = (_index, item) => item,
  emptyFactory?: SxBlockFactory,
): SxKeyedBlock<T> {
  const block = new SxKeyedBlock(
    anchor,
    factory,
    trackBy,
    emptyFactory,
  );
  block.bind(source);
  return block;
}

function assertUniqueKeys<T>(
  items: readonly T[],
  trackBy: SxTrackBy<T>,
): void {
  const keys = new Set<unknown>();

  for (let index = 0; index < items.length; index += 1) {
    const key = trackBy(index, items[index]);

    if (keys.has(key)) {
      throw new Error(
        `Duplicate sx collection key at index ${index}: ${String(key)}.`,
      );
    }

    keys.add(key);
  }
}

function toArray<T>(
  source: Iterable<T> | undefined,
): readonly T[] {
  if (source === undefined) return [];

  return Array.isArray(source)
    ? source
    : Array.from(source);
}

function moveInstanceAfter(
  anchor: Node,
  instance: SxBlockInstance,
): void {
  const parent = anchor.parentNode;

  if (!parent) {
    throw new Error(
      'sx structural anchor is not attached to the DOM.',
    );
  }

  const before = anchor.nextSibling;

  if (before === instance.first) {
    return;
  }

  const nodes = collectRange(
    instance.first,
    instance.last,
  );

  for (const node of nodes) {
    parent.insertBefore(node, before);
  }
}

function removeInstance(
  instance: SxBlockInstance,
): void {
  for (const node of collectRange(
    instance.first,
    instance.last,
  )) {
    node.parentNode?.removeChild(node);
  }
}

function collectRange(
  first: Node,
  last: Node,
): Node[] {
  const nodes: Node[] = [];
  let current: Node | null = first;

  while (current) {
    nodes.push(current);

    if (current === last) {
      return nodes;
    }

    current = current.nextSibling;
  }

  throw new Error(
    'Invalid sx structural DOM range.',
  );
}