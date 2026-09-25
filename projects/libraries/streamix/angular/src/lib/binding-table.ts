import type {
  DependencySource,
  Subscription,
} from '@epikodelabs/streamix';

import {
  equalClass,
  equalText,
  writeAttribute,
  writeClass,
  writeProperty,
  writeStyle,
  writeText,
} from './binding-writers';
import {
  rendererScheduler,
  type RendererScheduler,
  type ScheduledBinding,
} from './render-scheduler';

export type BindingSlot = number;

type BindingWriter = (value: unknown) => void;
type BindingEquals = (previous: unknown, next: unknown) => boolean;
type BindingReader = () => unknown;
type BindingInvalidator = () => void;

/**
 * Preallocated binding table used by compiler-generated Streamix Angular views.
 *
 * A table owns N integer binding slots and one renderer-scheduler registration.
 * Source emissions only mark slots dirty. Direct bindings keep the latest
 * emitted value; expression slots reevaluate once per renderer flush; hybrid
 * slots coalesce Angular-view invalidation through the same table flush.
 */
export class SxBindingTable {
  private readonly writers: Array<BindingWriter | undefined>;
  private readonly equals: Array<BindingEquals | undefined>;
  private readonly readers: Array<BindingReader | undefined>;
  private readonly invalidators: Array<BindingInvalidator | undefined>;
  private readonly rendered: unknown[];
  private readonly pending: unknown[];
  private readonly subscriptions: Array<Subscription[] | undefined>;
  private readonly dirtyFlags: Uint8Array;
  private readonly dirtySlots: number[] = [];

  private scheduled?: ScheduledBinding;
  private destroyed = false;

  constructor(
    readonly size: number,
    private readonly scheduler: RendererScheduler = rendererScheduler,
  ) {
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError('Binding table size must be a non-negative integer.');
    }

    this.writers = new Array(size);
    this.equals = new Array(size);
    this.readers = new Array(size);
    this.invalidators = new Array(size);
    this.rendered = new Array(size);
    this.pending = new Array(size);
    this.subscriptions = new Array(size);
    this.dirtyFlags = new Uint8Array(size);
  }

  /**
   * Installs a compiler-generated one-source binding into an integer slot.
   * The initial source value is written synchronously.
   */
  bind<T>(
    slot: BindingSlot,
    source: DependencySource<T>,
    write: (value: T) => void,
    equal: (previous: T, next: T) => boolean = Object.is,
  ): void {
    this.assertLiveSlot(slot);
    this.unbind(slot);

    const initial = source.value;

    this.writers[slot] = write as BindingWriter;
    this.equals[slot] = equal as BindingEquals;
    this.rendered[slot] = initial;
    this.pending[slot] = initial;

    write(initial);

    this.subscriptions[slot] = [
      source.subscribe((value) => {
        if (this.destroyed) {
          return;
        }

        this.pending[slot] = value;
        this.markSlotDirty(slot);
      }),
    ];
  }

  /**
   * Installs a compiler-generated multi-source expression binding.
   *
   * The expression is evaluated synchronously once, then at most once per
   * renderer flush no matter how many dependencies emit in that frame.
   */
  bindExpression<T>(
    slot: BindingSlot,
    sources: readonly DependencySource<unknown>[],
    read: () => T,
    write: (value: T) => void,
    equal: (previous: T, next: T) => boolean = Object.is,
  ): void {
    this.assertLiveSlot(slot);
    this.unbind(slot);

    const initial = read();

    this.readers[slot] = read as BindingReader;
    this.writers[slot] = write as BindingWriter;
    this.equals[slot] = equal as BindingEquals;
    this.rendered[slot] = initial;
    this.pending[slot] = initial;

    write(initial);

    this.subscriptions[slot] = sources.map(source =>
      source.subscribe(() => {
        if (!this.destroyed) {
          this.markSlotDirty(slot);
        }
      }),
    );
  }

  /**
   * Installs Streamix-driven invalidation for an Angular-owned expression.
   *
   * The invalidator is not called initially because Angular performs the
   * initial template render. During a flush, identical invalidator callbacks
   * are invoked only once even if several hybrid bindings became dirty.
   */
  bindInvalidation(
    slot: BindingSlot,
    sources: readonly DependencySource<unknown>[],
    invalidate: () => void,
  ): void {
    this.assertLiveSlot(slot);
    this.unbind(slot);

    this.invalidators[slot] = invalidate;
    this.subscriptions[slot] = sources.map(source =>
      source.subscribe(() => {
        if (!this.destroyed) {
          this.markSlotDirty(slot);
        }
      }),
    );
  }

  /** Removes one slot binding without destroying the table. */
  unbind(slot: BindingSlot): void {
    this.assertSlot(slot);

    for (const subscription of this.subscriptions[slot] ?? []) {
      subscription();
    }
    this.subscriptions[slot] = undefined;

    this.writers[slot] = undefined;
    this.equals[slot] = undefined;
    this.readers[slot] = undefined;
    this.invalidators[slot] = undefined;
    this.rendered[slot] = undefined;
    this.pending[slot] = undefined;
    this.dirtyFlags[slot] = 0;
  }

  /** Flushes this table immediately. Primarily useful for tests/benchmarks. */
  flushNow(): void {
    if (!this.destroyed) {
      this.flush();
    }
  }

  /** Tears down every source subscription and releases all table slots. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    this.scheduled?.destroy();
    this.scheduled = undefined;

    for (let slot = 0; slot < this.size; slot += 1) {
      for (const subscription of this.subscriptions[slot] ?? []) {
        subscription();
      }
      this.subscriptions[slot] = undefined;

      this.writers[slot] = undefined;
      this.equals[slot] = undefined;
      this.readers[slot] = undefined;
      this.invalidators[slot] = undefined;
      this.rendered[slot] = undefined;
      this.pending[slot] = undefined;
      this.dirtyFlags[slot] = 0;
    }

    this.dirtySlots.length = 0;
  }

  get pendingCount(): number {
    return this.dirtySlots.length;
  }

  private markSlotDirty(slot: BindingSlot): void {
    if (this.dirtyFlags[slot] === 0) {
      this.dirtyFlags[slot] = 1;
      this.dirtySlots.push(slot);
    }

    this.ensureScheduled();
  }

  private ensureScheduled(): void {
    if (!this.scheduled) {
      this.scheduled = this.scheduler.register(() => this.flush());
    }

    this.scheduled.markDirty();
  }

  private flush(): void {
    if (this.destroyed || this.dirtySlots.length === 0) {
      return;
    }

    const invalidators = new Set<BindingInvalidator>();
    let index = 0;

    while (index < this.dirtySlots.length) {
      const slot = this.dirtySlots[index++];
      this.dirtyFlags[slot] = 0;

      const invalidator = this.invalidators[slot];
      if (invalidator) {
        invalidators.add(invalidator);
        continue;
      }

      const write = this.writers[slot];
      if (!write) {
        continue;
      }

      const previous = this.rendered[slot];
      const equal = this.equals[slot] ?? Object.is;

      try {
        const next = this.readers[slot]
          ? this.readers[slot]!()
          : this.pending[slot];

        if (equal(previous, next)) {
          continue;
        }

        write(next);
        this.rendered[slot] = next;
      } catch (error) {
        // One failing expression/writer must not strand sibling slots in the
        // same flush. Keep the previous rendered value so a later emission can
        // retry the expression/write.
        console.error(`sx binding slot ${slot} update failed.`, error);
      }
    }

    // Clear before running Angular invalidation: detectChanges() can itself
    // cause Streamix emissions, which must enqueue fresh work rather than be
    // erased by this flush.
    this.dirtySlots.length = 0;

    for (const invalidate of invalidators) {
      try {
        invalidate();
      } catch (error) {
        console.error('sx Angular view invalidation failed.', error);
      }
    }
  }

  private assertSlot(slot: BindingSlot): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.size) {
      throw new RangeError(
        `Binding slot ${slot} is outside table range 0..${this.size - 1}.`,
      );
    }
  }

  private assertLiveSlot(slot: BindingSlot): void {
    if (this.destroyed) {
      throw new Error('Cannot bind a destroyed SxBindingTable.');
    }

    this.assertSlot(slot);
  }
}

/** Creates the preallocated binding table emitted by the sx compiler. */
export function createBindingTable(
  size: number,
  scheduler?: RendererScheduler,
): SxBindingTable {
  return new SxBindingTable(size, scheduler);
}

/** Compiler instruction: direct text-content binding. @internal */
export function ɵsxText(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Node,
  source: DependencySource<unknown>,
): void {
  table.bind(slot, source, writeText(target), equalText);
}

/** Compiler instruction: direct reactive text expression. @internal */
export function ɵsxTextExpression(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Node,
  sources: readonly DependencySource<unknown>[],
  read: () => unknown,
): void {
  table.bindExpression(slot, sources, read, writeText(target), equalText);
}

/** Compiler instruction: Angular-owned hybrid-expression invalidation. @internal */
export function ɵsxInvalidate(
  table: SxBindingTable,
  slot: BindingSlot,
  sources: readonly DependencySource<unknown>[],
  invalidate: () => void,
): void {
  table.bindInvalidation(slot, sources, invalidate);
}

/** Compiler instruction: direct DOM-property binding. @internal */
export function ɵsxProperty<T>(
  table: SxBindingTable,
  slot: BindingSlot,
  target: object,
  property: string,
  source: DependencySource<T>,
): void {
  table.bind(slot, source, writeProperty(target, property));
}

/** Compiler instruction: direct attribute binding. @internal */
export function ɵsxAttribute(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  attribute: string,
  source: DependencySource<unknown>,
): void {
  table.bind(slot, source, writeAttribute(target, attribute));
}

/** Compiler instruction: direct class binding. @internal */
export function ɵsxClass(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  className: string,
  source: DependencySource<unknown>,
): void {
  table.bind(slot, source, writeClass(target, className), equalClass);
}

/** Compiler instruction: direct style binding. @internal */
export function ɵsxStyle(
  table: SxBindingTable,
  slot: BindingSlot,
  target: HTMLElement,
  property: string,
  source: DependencySource<unknown>,
): void {
  table.bind(slot, source, writeStyle(target, property));
}
