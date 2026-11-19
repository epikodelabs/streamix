import type {
  DependencySource,
  Subscription,
} from '@epikodelabs/streamix';

import {
  rendererScheduler,
  type ScheduledBinding,
} from './render-scheduler';
import { ɵsxCurrentRenderErrorSink } from './error-delivery';
import { combineSubscriptions, readSourceState, readViewExpression, subscribeSourceError, viewValue } from './view-value';

/**
 * Content-scope attributes captured from a block's marker element, keyed by
 * the anchor that replaced it. The marker is authored in the component
 * template, so its `_ngcontent-*` attributes are the block's own scope.
 */
const markerContentAttributes = new WeakMap<Node, readonly string[]>();

/** Wrapper avoids the `error === undefined` ambiguity for stored failures. */
interface BlockFailure {
  error: unknown;
}

export interface SxBlockInstance {
  readonly first: Node;
  readonly last: Node;
  destroy(): void;
  /** Re-run compiled bindings when a parent loop's context changes. */
  refresh?(): void;
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
  /** Captured at creation so delivery always uses the owning application's handler. */
  private readonly errorSink = ɵsxCurrentRenderErrorSink();
  private unsubscribe?: Subscription;
  private scheduled?: ScheduledBinding;
  private pending: T | undefined | typeof UNSET = UNSET;
  private failure?: BlockFailure;
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
    // Delivery contract (React/Vue parity): a failed source delivers at
    // setup; pending and completed sources render like any pending read.
    const state = readSourceState(source);
    if (state.status === "failed") throw state.error;
    this.render((state.status === "value" ? state.value : undefined) as T | undefined);

    const generation = ++this.generation;

    let subscribing = true;
    const valueSubscription = source.subscribe(value => {
      if (generation !== this.generation || subscribing) return;

      // A successful emission clears a stored failure: the block recovers in
      // place on the next frame.
      this.failure = undefined;
      this.pending = value;
      this.ensureScheduled(generation);
    });
    subscribing = false;
    // fail() never notifies value subscribers; failures reach the block only
    // through onError.
    const errorSubscription = subscribeSourceError(source, error => {
      if (generation !== this.generation || this.destroyed) return;
      this.failure = { error };
      this.ensureScheduled(generation);
    });
    this.unsubscribe = combineSubscriptions(valueSubscription, errorSubscription);
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
          generation !== this.generation
        ) {
          return;
        }

        // Delivery contract: a stored source failure is delivered through the
        // error sink instead of rendering, until a successful emission clears it.
        if (this.failure) {
          this.errorSink(this.failure.error);
          return;
        }

        if (this.pending === UNSET) {
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
    value = viewValue(value);
    if (this.destroyed || Object.is(this.current, value)) {
      return;
    }

    if (value === undefined) {
      this.current = value;
      this.removeInstance();
      return;
    }

    if (!this.instance) {
      const previous = this.current;
      this.current = value;

      try {
        this.instance = this.factory.create(value);
        applyContentScope(this.instance, this.anchor);
        moveInstanceAfter(this.anchor, this.instance);
      } catch (error) {
        // The value was committed before the factory ran, so a failed factory
        // or move would leave `Object.is(current, value)` true with no
        // instance: every later emission of the same value would be skipped.
        // Roll back so the next emission re-creates the instance.
        this.current = previous;
        throw error;
      }

      return;
    }

    this.factory.update?.(this.instance, value);
    this.current = value;
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
    this.failure = undefined;
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
  if (isSxExpression(value)) return readViewExpression(value.sources, value.read);
  // Delivery contract: a failed direct source delivers its stored error;
  // pending sources read as undefined; completed sources keep the core's
  // disposed-read semantics.
  const state = readSourceState(value);
  if (state.status === "failed") throw state.error;
  if (state.status === "pending") return undefined as T;
  if (state.status === "completed") return viewValue(value.value);
  return viewValue(state.value) as T;
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
  /** Captured at creation so delivery always uses the owning application's handler. */
  private readonly errorSink = ɵsxCurrentRenderErrorSink();
  private unsubscribes: Subscription[] = [];
  private scheduled?: ScheduledBinding;
  private instance?: SxBlockInstance;
  private current = -1;
  private generation = 0;
  private destroyed = false;
  private failure?: BlockFailure;

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

          // A successful emission clears a stored failure: the selection
          // re-evaluates in place on the next frame.
          this.failure = undefined;
          this.ensureScheduled(generation);
        }));
        // fail() never notifies value subscribers; failures reach the block
        // only through onError.
        const errorSubscription = subscribeSourceError(source, error => {
          if (generation !== this.generation || this.destroyed) return;
          this.failure = { error };
          this.ensureScheduled(generation);
        });
        if (errorSubscription) this.unsubscribes.push(errorSubscription);
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

        // Delivery contract: a stored source failure is delivered through the
        // error sink instead of re-selecting a branch, until a successful
        // emission clears it.
        if (this.failure) {
          this.errorSink(this.failure.error);
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
      this.instance?.refresh?.();
      return;
    }

    this.removeInstance();
    this.current = index;

    if (index < 0) {
      return;
    }

    try {
      this.instance = this.branches[index].factory();
      applyContentScope(this.instance, this.anchor);
      moveInstanceAfter(this.anchor, this.instance);
    } catch (error) {
      // The selection was committed before the branch factory ran, so a
      // failed factory or move would leave `index === current` with no
      // instance: every later render would refresh nothing and never retry
      // the branch. Roll back to the empty state instead — the next render
      // re-selects and re-creates from scratch.
      this.current = -1;
      throw error;
    }
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

    this.failure = undefined;
  }
}

export class SxKeyedBlock<T> {
  /** Captured at creation so delivery always uses the owning application's handler. */
  private readonly errorSink = ɵsxCurrentRenderErrorSink();
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
  private failure?: BlockFailure;

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
    // readSxValue delivers a failed dependency's stored error at setup.
    this.render(toArray(readSxValue(source)));

    const generation = ++this.generation;

    let subscribing = true;
    for (const dependency of sourcesOf(source)) {
      this.unsubscribes.push(dependency.subscribe(() => {
        if (generation !== this.generation || subscribing) return;

        // A successful emission clears a stored failure: the collection
        // re-renders in place on the next frame.
        this.failure = undefined;
        this.pending = source;
        this.ensureScheduled(generation);
      }));
      // fail() never notifies value subscribers; failures reach the block
      // only through onError.
      const errorSubscription = subscribeSourceError(dependency, error => {
        if (generation !== this.generation || this.destroyed) return;
        this.failure = { error };
        this.ensureScheduled(generation);
      });
      if (errorSubscription) this.unsubscribes.push(errorSubscription);
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

        // Delivery contract: a stored source failure is delivered through the
        // error sink instead of re-rendering the collection, until a
        // successful emission clears it.
        if (this.failure) {
          this.errorSink(this.failure.error);
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
        applyContentScope(this.emptyInstance, this.anchor);
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
    const created: CollectionRecord<T>[] = [];
    let cursor: Node = this.anchor;

    try {
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
          const instance = this.factory.create(item, index, items.length);
          applyContentScope(instance, this.anchor);
          record = { key, item, instance };
          created.push(record);
        }

        moveInstanceAfter(cursor, record.instance);
        cursor = record.instance.last;
        next.push(record);
      }
    } catch (error) {
      // Instances created earlier in the failed pass are not tracked in
      // `records` yet, so a plain rethrow would leak their DOM and
      // subscriptions. Destroy them; reused records stay tracked and recover
      // on the next render.
      for (const record of created) {
        try {
          removeInstance(record.instance);
        } catch {
          // A half-inserted range cannot be walked; the subscriptions are
          // still released below.
        }
        record.instance.destroy();
      }
      throw error;
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
    this.failure = undefined;
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
 * During server rendering the marker element is kept but stays empty: the
 * client template declares an empty marker, so rendering block content inside
 * it would cause a hydration mismatch. Angular-owned fallbacks still render
 * direct bindings. In the browser the marker is replaced by a comment anchor,
 * which keeps CSS selectors such as `ul > li`/`:first-child` intact.
 *
 * @internal
 */
export function ɵsxBlockAnchor(
  marker: Element,
  label: string,
  server = false,
): Node {
  // Capture the template's own content-scope attributes before the marker is
  // replaced. Comments cannot carry attributes, and at a template root the
  // anchor's parent is the component host, which carries `_nghost-*` (and a
  // parent's `_ngcontent-*` when nested) instead of the block's own scope.
  const contentAttributes = marker
    .getAttributeNames()
    .filter(name => name.startsWith('_ngcontent-'));

  if (server) {
    markerContentAttributes.set(marker, contentAttributes);
    return marker;
  }

  const anchor = marker.ownerDocument!.createComment(label);
  markerContentAttributes.set(anchor, contentAttributes);
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

  for (const node of collectRange(instance.first, instance.last)) {
    parent.insertBefore(node, before);
  }
}

/**
 * Applies the surrounding template's Angular content-scope attributes to a
 * freshly created block range.
 *
 * Direct DOM factories bypass Angular's renderer, so their elements need the
 * `_ngcontent-*` attributes for scoped styles to match. Attributes come from
 * the block's captured marker first: at a template root the anchor's parent
 * is the component host, whose attributes belong to a different scope.
 * Anchors created without `ɵsxBlockAnchor` fall back to the enclosing
 * element's scope attributes. This runs once when an instance is created:
 * later reorders only move existing nodes, so a list reorder no longer walks
 * every descendant of every row.
 */
function applyContentScope(
  instance: SxBlockInstance,
  anchor: Node,
): void {
  const contentAttributes = resolveContentAttributes(anchor);
  if (!contentAttributes || contentAttributes.length === 0) {
    return;
  }

  for (const node of collectRange(instance.first, instance.last)) {
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    for (const target of [element, ...Array.from(element.querySelectorAll('*'))]) {
      for (const attribute of contentAttributes) {
        if (!target.hasAttribute(attribute)) {
          target.setAttribute(attribute, '');
        }
      }
    }
  }
}

function resolveContentAttributes(
  anchor: Node,
): readonly string[] | undefined {
  const captured = markerContentAttributes.get(anchor);

  if (captured) {
    return captured;
  }

  const parent = anchor.parentNode;

  if (!parent || parent.nodeType !== 1) {
    return undefined;
  }

  return (parent as Element)
    .getAttributeNames()
    .filter(name => name.startsWith('_ngcontent-'));
}

function removeInstance(
  instance: SxBlockInstance,
): void {  for (const node of collectRemovalRange(
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

/**
 * Like `collectRange`, but tolerates a sibling chain that was already broken
 * by removal. Destroying an instance after its enclosing range was removed
 * (a keyed row torn down before its nested blocks) walks a chain whose links
 * are nulled, so `last` stays unreachable; everything the enclosing removal
 * covered is detached already, and an all-detached walk needs no further
 * removal. A node that is still attached means the range was changed outside
 * the block runtime and remains invalid.
 */
function collectRemovalRange(
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

  if (nodes.every(node => node.parentNode === null)) {
    return nodes;
  }

  throw new Error(
    'Invalid sx structural DOM range.',
  );
}
