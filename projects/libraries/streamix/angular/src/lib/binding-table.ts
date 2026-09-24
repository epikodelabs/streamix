import type {
  DependencySource,
  Subscription,
} from '@epikodelabs/streamix';

import {
  rendererScheduler,
  type RendererScheduler,
  type ScheduledBinding,
} from './render-scheduler';

export type BindingSlot = number;

type BindingWriter = (value: unknown) => void;
type BindingEquals = (previous: unknown, next: unknown) => boolean;

/**
 * Preallocated binding table used by compiler-generated Streamix Angular views.
 *
 * A table owns N integer binding slots and one renderer-scheduler registration.
 * Source emissions only:
 *
 *   1. store the latest value for the slot
 *   2. append the integer slot to the dirty queue once
 *   3. mark the table dirty
 *
 * The next renderer flush walks only dirty slots and performs their direct DOM
 * writes. There is no Angular change-detection pass and no virtual-DOM diff.
 */
export class SxBindingTable {
  private readonly writers: Array<BindingWriter | undefined>;
  private readonly equals: Array<BindingEquals | undefined>;
  private readonly rendered: unknown[];
  private readonly pending: unknown[];
  private readonly subscriptions: Array<Subscription | undefined>;
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
    this.rendered = new Array(size);
    this.pending = new Array(size);
    this.subscriptions = new Array(size);
    this.dirtyFlags = new Uint8Array(size);
  }

  /**
   * Installs a compiler-generated binding into an integer slot.
   *
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

    this.subscriptions[slot] = source.subscribe((value) => {
      if (this.destroyed) {
        return;
      }

      this.pending[slot] = value;

      if (this.dirtyFlags[slot] === 0) {
        this.dirtyFlags[slot] = 1;
        this.dirtySlots.push(slot);
      }

      this.ensureScheduled();
    });
  }

  /**
   * Removes one slot binding without destroying the table.
   */
  unbind(slot: BindingSlot): void {
    this.assertSlot(slot);

    const subscription = this.subscriptions[slot];
    this.subscriptions[slot] = undefined;
    subscription?.();

    this.writers[slot] = undefined;
    this.equals[slot] = undefined;
    this.rendered[slot] = undefined;
    this.pending[slot] = undefined;
    this.dirtyFlags[slot] = 0;
  }

  /**
   * Flushes this table immediately. Primarily useful for tests and benchmarks.
   */
  flushNow(): void {
    if (this.destroyed) {
      return;
    }

    this.flush();
  }

  /**
   * Tears down every source subscription and releases all table slots.
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    this.scheduled?.destroy();
    this.scheduled = undefined;

    for (let slot = 0; slot < this.size; slot += 1) {
      const subscription = this.subscriptions[slot];
      this.subscriptions[slot] = undefined;
      subscription?.();

      this.writers[slot] = undefined;
      this.equals[slot] = undefined;
      this.rendered[slot] = undefined;
      this.pending[slot] = undefined;
      this.dirtyFlags[slot] = 0;
    }

    this.dirtySlots.length = 0;
  }

  get pendingCount(): number {
    return this.dirtySlots.length;
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

    let index = 0;

    while (index < this.dirtySlots.length) {
      const slot = this.dirtySlots[index++];
      this.dirtyFlags[slot] = 0;

      const write = this.writers[slot];
      if (!write) {
        continue;
      }

      const next = this.pending[slot];
      const previous = this.rendered[slot];
      const equal = this.equals[slot] ?? Object.is;

      if (equal(previous, next)) {
        continue;
      }

      this.rendered[slot] = next;

      try {
        write(next);
      } catch (error) {
        // One failing writer must not strand sibling slots in the same
        // flush. The slot keeps its previous rendered value so the next
        // emission retries the write; it is deliberately not retried on a
        // timer, which would re-throw every frame while the failure
        // persists.
        this.rendered[slot] = previous;
        console.error(`sx binding slot ${slot} write failed.`, error);
      }
    }

    this.dirtySlots.length = 0;
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

/**
 * Creates the preallocated binding table emitted by the sx compiler.
 */
export function createBindingTable(
  size: number,
  scheduler?: RendererScheduler,
): SxBindingTable {
  return new SxBindingTable(size, scheduler);
}

/**
 * Compiler instruction: direct text-content binding.
 *
 * @internal
 */
export function ɵsxText(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Node,
  source: DependencySource<unknown>,
): void {
  table.bind(
    slot,
    source,
    value => {
      target.textContent = value == null ? '' : String(value);
    },
    (previous, next) =>
      (previous == null ? '' : String(previous)) ===
      (next == null ? '' : String(next)),
  );
}

/**
 * Compiler instruction: direct DOM-property binding.
 *
 * @internal
 */
export function ɵsxProperty<T>(
  table: SxBindingTable,
  slot: BindingSlot,
  target: object,
  property: string,
  source: DependencySource<T>,
): void {
  table.bind(slot, source, value => {
    (target as Record<string, unknown>)[property] = value;
  });
}

/**
 * Compiler instruction: direct attribute binding.
 *
 * @internal
 */
export function ɵsxAttribute(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  attribute: string,
  source: DependencySource<unknown>,
): void {
  table.bind(slot, source, value => {
    if (value == null || value === false) {
      target.removeAttribute(attribute);
      return;
    }

    target.setAttribute(attribute, value === true ? '' : String(value));
  });
}

/**
 * Compiler instruction: direct class binding.
 *
 * @internal
 */
export function ɵsxClass(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  className: string,
  source: DependencySource<unknown>,
): void {
  table.bind(
    slot,
    source,
    value => {
      target.classList.toggle(className, Boolean(value));
    },
    (previous, next) => Boolean(previous) === Boolean(next),
  );
}

/**
 * Compiler instruction: direct style binding.
 *
 * @internal
 */
export function ɵsxStyle(
  table: SxBindingTable,
  slot: BindingSlot,
  target: HTMLElement,
  property: string,
  source: DependencySource<unknown>,
): void {
  table.bind(slot, source, value => {
    if (value == null || value === false) {
      target.style.removeProperty(property);
      return;
    }

    target.style.setProperty(property, String(value));
  });
}
