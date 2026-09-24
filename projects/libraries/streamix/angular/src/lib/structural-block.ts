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
  create(item: T, index: number): SxBlockInstance;
  update?(
    instance: SxBlockInstance,
    item: T,
    index: number,
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
    private readonly anchor: Comment,
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

    this.unsubscribe = source.subscribe(value => {
      if (generation !== this.generation) return;

      this.pending = value;
      this.ensureScheduled(generation);
    });
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

export class SxKeyedBlock<T> {
  private unsubscribe?: Subscription;
  private scheduled?: ScheduledBinding;
  private pending?: readonly T[];
  private records: CollectionRecord<T>[] = [];
  private generation = 0;
  private destroyed = false;

  constructor(
    private readonly anchor: Comment,
    private readonly factory: SxCollectionBlockFactory<T>,
    private readonly trackBy: SxTrackBy<T>,
  ) {}

  bind(source: DependencySource<Iterable<T> | undefined>): void {
    if (this.destroyed) {
      throw new Error('Cannot bind a destroyed sx keyed block.');
    }

    this.unbind();
    this.render(toArray(source.value));

    const generation = ++this.generation;

    this.unsubscribe = source.subscribe(value => {
      if (generation !== this.generation) return;

      this.pending = toArray(value);
      this.ensureScheduled(generation);
    });
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

        const items = this.pending ?? [];
        this.pending = undefined;
        this.render(items);
      });
    }

    this.scheduled.markDirty();
  }

  private render(items: readonly T[]): void {
    if (this.destroyed) return;

    assertUniqueKeys(items, this.trackBy);

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
          record.instance,
          item,
          index,
        );
      } else {
        record = {
          key,
          item,
          instance: this.factory.create(item, index),
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

    this.unsubscribe?.();
    this.unsubscribe = undefined;

    this.scheduled?.destroy();
    this.scheduled = undefined;

    this.pending = undefined;
  }
}

export function ɵcreateSxValueBlock<T>(
  anchor: Comment,
  source: DependencySource<T | undefined>,
  factory: SxValueBlockFactory<T>,
): SxValueBlock<T> {
  const block = new SxValueBlock(anchor, factory);
  block.bind(source);
  return block;
}

export function ɵcreateSxKeyedBlock<T>(
  anchor: Comment,
  source: DependencySource<Iterable<T> | undefined>,
  factory: SxCollectionBlockFactory<T>,
  trackBy: SxTrackBy<T> = (_index, item) => item,
): SxKeyedBlock<T> {
  const block = new SxKeyedBlock(
    anchor,
    factory,
    trackBy,
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
