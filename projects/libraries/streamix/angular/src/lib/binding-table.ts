import {
  recordStreamixDevtoolsEvent,
  ɵcreateDisposer,
  ɵDisposalQueue,
  type DependencySource,
  type Subscription,
} from '@epikodelabs/streamix';

import {
  equalClass,
  equalText,
  writeAttribute,
  writeClass,
  writeClassMap,
  writeProperty,
  writeStyle,
  writeStyleMap,
  writeText,
  type SxClassMap,
  type SxStyleMap,
} from './binding-writers';
import {
  rendererScheduler,
  type RendererScheduler,
  type ScheduledBinding,
} from './render-scheduler';
import { combineSubscriptions, readSourceState, readViewExpression, subscribeSourceError, viewValue } from './view-value';
import { ɵsxCurrentRenderErrorSink } from './error-delivery';
import { registerSxConstruction } from './block-construction';

export type BindingSlot = number;

type BindingWriter = ((value: unknown) => void) & { destroy?: () => void };
type BindingEquals = (previous: unknown, next: unknown) => boolean;
type BindingReader = () => unknown;
/** Wrapper avoids the `error === undefined` ambiguity for stored failures. */
type SlotError = { error: unknown };

/**
 * Preallocated binding table used by compiler-generated Streamix Angular views.
 *
 * A table owns N integer binding slots and one renderer-scheduler registration.
 * Source emissions only mark slots dirty. Direct bindings keep the latest
 * emitted value, expression slots re-evaluate once per renderer flush, and
 * listener slots hold a DOM listener plus its remover for teardown.
 */
export class SxBindingTable {
  private readonly writers: Array<BindingWriter | undefined>;
  private readonly equals: Array<BindingEquals | undefined>;
  private readonly readers: Array<BindingReader | undefined>;
  private readonly labels: Array<string | undefined>;
  private readonly rendered: unknown[];
  private readonly pending: unknown[];
  /** Last source failure per slot, delivered through the error sink on flush. */
  private readonly slotErrors: Array<SlotError | undefined>;
  private readonly subscriptions: Array<Subscription[] | undefined>;
  /** Listener removers, cleared on unbind so teardown needs no extra plumbing. */
  private readonly teardowns: Array<(() => void) | undefined>;
  private readonly dirtyFlags: Uint8Array;
  private readonly dirtySlots: number[] = [];

  private scheduled?: ScheduledBinding;
  private destroyed = false;
  private readonly disposals = new ɵDisposalQueue();
  /** Captured at creation so delivery always uses the owning application's handler. */
  private readonly errorSink = ɵsxCurrentRenderErrorSink();

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
    this.labels = new Array(size);
    this.rendered = new Array(size);
    this.pending = new Array(size);
    this.slotErrors = new Array(size);
    this.subscriptions = new Array(size);
    this.teardowns = new Array(size);
    this.dirtyFlags = new Uint8Array(size);

    // A binding table created inside a block factory registers with the
    // active construction frame, so a throw from the enclosing factory
    // destroys it instead of leaving its source subscriptions behind.
    registerSxConstruction(this);
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
    name?: string,
  ): void {
    this.assertLiveSlot(slot);
    this.unbind(slot);

    // Delivery contract: a failed source delivers at setup; pending and
    // completed sources bind undefined like any other pending view read.
    const state = readSourceState(source);
    if (state.status === "failed") throw state.error;
    const initial = (state.status === "value" ? viewValue(state.value) : undefined) as T;

    this.writers[slot] = write as BindingWriter;
    this.equals[slot] = equal as BindingEquals;
    this.rendered[slot] = initial;
    this.pending[slot] = initial;

    write(initial);

    let subscribing = true;
    const subscription = source.subscribe((value) => {
      if (this.destroyed || subscribing) {
        return;
      }

      // A successful emission clears a stored failure: the view recovers in
      // place on the next flush.
      this.slotErrors[slot] = undefined;
      this.pending[slot] = viewValue(value);
      this.markSlotDirty(slot);
    });
    subscribing = false;

    const subscriptions: Subscription[] = [subscription];
    // fail() never notifies value subscribers, so failures reach the table
    // only through onError: the failure is stored and the slot flush delivers
    // it through the error sink.
    const errorSubscription = subscribeSourceError(source, error => {
      if (this.destroyed) return;
      this.slotErrors[slot] = { error };
      this.markSlotDirty(slot);
    });
    if (errorSubscription) subscriptions.push(errorSubscription);
    this.subscriptions[slot] = subscriptions;
    this.labels[slot] = name;
    recordStreamixDevtoolsEvent({ type: "subscription", source: this.slotLabel(slot) });
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
    name?: string,
  ): void {
    this.assertLiveSlot(slot);
    this.unbind(slot);

    const readView = () => readViewExpression(sources, read);
    const initial = readView();

    this.readers[slot] = readView as BindingReader;
    this.writers[slot] = write as BindingWriter;
    this.equals[slot] = equal as BindingEquals;
    this.rendered[slot] = initial;
    this.pending[slot] = initial;

    write(initial);

    this.subscriptions[slot] = this.subscribeForFlush(slot, sources);
    this.labels[slot] = name;
    recordStreamixDevtoolsEvent({ type: "subscription", source: this.slotLabel(slot) });
  }

  /**
   * Installs a compiler-generated event listener into an integer slot.
   *
   * The listener writes nothing, so the slot never flushes; it exists so
   * `unbind`/`destroy` remove listeners through the same teardown path as
   * source subscriptions.
   */
  bindListener(
    slot: BindingSlot,
    target: EventTarget,
    type: string,
    handler: (event: any) => void,
    options?: AddEventListenerOptions,
  ): void {
    this.assertLiveSlot(slot);
    this.unbind(slot);

    target.addEventListener(type, handler, options);
    this.teardowns[slot] = () =>
      target.removeEventListener(type, handler, options);
    recordStreamixDevtoolsEvent({ type: "subscription", source: this.slotLabel(slot) });
  }

  /**
   * Re-evaluates a contextual expression synchronously after a keyed row or
   * enclosing context changes. The existing subscriptions remain installed.
   * A pending source-triggered frame may still run, but equality suppresses
   * duplicate DOM writes. Only compiler-owned expression slots may refresh.
   */
  refreshExpression(slot: BindingSlot): void {
    this.assertLiveSlot(slot, 'refresh');
    if (!this.readers[slot] || !this.writers[slot]) {
      throw new Error(`Cannot refresh non-expression binding slot ${slot}.`);
    }
    this.renderExpressionSlot(slot);
  }

  /** Removes one slot binding without destroying the table. */
  unbind(slot: BindingSlot): void {
    this.assertLiveSlot(slot, 'unbind');
    this.unsubscribeSlot(slot);
    this.clearSlot(slot);
  }

  /** Flushes this table immediately. Primarily useful for tests/benchmarks. */
  flushNow(): void {
    if (!this.destroyed) {
      this.flush();
    }
  }

  /** Tears down every source subscription and releases all table slots. */
  readonly destroy = ɵcreateDisposer(queue => {
    this.destroyed = true;

    queue.run(() => this.scheduled?.destroy());
    this.scheduled = undefined;

    for (let slot = 0; slot < this.size; slot += 1) {
      this.unsubscribeSlot(slot);
      queue.run(() => this.clearSlot(slot));
    }

    this.dirtySlots.length = 0;
  }, this.disposals);

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

  /**
   * Subscribes a slot to sources that only need to trigger a coalesced flush.
   * A DependencySource may synchronously emit its current value on subscribe;
   * that initial delivery belongs to the synchronous setup above, not a
   * renderer frame, so it is deliberately ignored.
   */
  private subscribeForFlush(
    slot: BindingSlot,
    sources: readonly DependencySource<unknown>[],
  ): Subscription[] {
    return sources.map(source => {
      let subscribing = true;
      const subscription = source.subscribe(() => {
        if (!this.destroyed && !subscribing) {
          this.markSlotDirty(slot);
        }
      });
      subscribing = false;
      const subscriptions = [subscription];
      // Expression slots learn about failures the same way direct slots do:
      // the stored failure is delivered by the next flush of this slot.
      const errorSubscription = subscribeSourceError(source, error => {
        if (this.destroyed) return;
        this.slotErrors[slot] = { error };
        this.markSlotDirty(slot);
      });
      if (errorSubscription) subscriptions.push(errorSubscription);
      return subscriptions.length === 1 ? subscription : combineSubscriptions(...subscriptions);
    });
  }

  private unsubscribeSlot(slot: BindingSlot): void {
    if (this.subscriptions[slot] !== undefined || this.teardowns[slot] !== undefined) {
      recordStreamixDevtoolsEvent({ type: "unsubscribe", source: this.slotLabel(slot) });
    }
    for (const subscription of this.subscriptions[slot] ?? []) {
      this.disposals.run(subscription);
    }
    this.subscriptions[slot] = undefined;
  }

  private clearSlot(slot: BindingSlot): void {
    this.teardowns[slot]?.();
    this.teardowns[slot] = undefined;
    this.writers[slot]?.destroy?.();
    this.writers[slot] = undefined;
    this.equals[slot] = undefined;
    this.readers[slot] = undefined;
    this.labels[slot] = undefined;
    this.rendered[slot] = undefined;
    this.pending[slot] = undefined;
    this.slotErrors[slot] = undefined;
    this.dirtyFlags[slot] = 0;
  }

  private flush(): void {
    if (this.destroyed || this.dirtySlots.length === 0) {
      return;
    }

    let index = 0;
    let written = 0;

    while (index < this.dirtySlots.length) {
      const slot = this.dirtySlots[index++];
      // Clear this flag before invoking the writer: synchronous re-emissions
      // must enqueue a new slot instead of being silently dropped.
      this.dirtyFlags[slot] = 0;

      if (this.renderExpressionSlot(slot)) {
        written += 1;
        recordStreamixDevtoolsEvent({ type: "write", source: this.slotLabel(slot) });
      }
    }

    // All newly enqueued work was consumed by the dynamically sized loop.
    this.dirtySlots.length = 0;

    if (written > 0) {
      recordStreamixDevtoolsEvent({
        type: "render",
        source: `${written} ${written === 1 ? "binding" : "bindings"}`,
      });
    }
  }

  private renderExpressionSlot(slot: BindingSlot): boolean {
    const write = this.writers[slot];
    if (!write) return false;
    const equal = this.equals[slot] ?? Object.is;
    // Delivery contract (React/Vue parity): a stored source failure is
    // delivered through the error sink instead of keeping the previous
    // successful value rendered. The slot stays failed until a successful
    // emission clears it.
    const slotError = this.slotErrors[slot];
    if (slotError) {
      this.errorSink(slotError.error);
      return false;
    }
    try {
      const next = this.readers[slot] ? this.readers[slot]!() : this.pending[slot];
      if (!equal(this.rendered[slot], next)) {
        write(next);
        this.rendered[slot] = next;
        return true;
      }
      return false;
    } catch (error) {
      // Preserve the previous successful value and isolate sibling slots for
      // unexpected reader or writer failures.
      this.errorSink(error);
      return false;
    }
  }

  /** DevTools label for a slot: the emitted binding name or a stable slot id. */
  private slotLabel(slot: BindingSlot): string {
    return `template binding ${this.labels[slot] ?? slot}`;
  }

  private assertSlot(slot: BindingSlot): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.size) {
      throw new RangeError(
        `Binding slot ${slot} is outside table range 0..${this.size - 1}.`,
      );
    }
  }

  private assertLiveSlot(slot: BindingSlot, action = 'bind'): void {
    if (this.destroyed) {
      throw new Error(`Cannot ${action} a destroyed SxBindingTable.`);
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


function boundTextNode(target: Element, textIndex = 0): Text {
  const first = Array.from(target.childNodes).filter(node => node.nodeType === 3)[textIndex];
  if (!first && textIndex > 0) throw new Error('Missing interpolation text node at index ' + textIndex);

  if (first?.nodeType === 3) {
    return first as Text;
  }

  const text = target.ownerDocument.createTextNode('');
  target.insertBefore(text, first ?? null);
  return text;
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

/**
 * Compiler instruction: direct binding to Angular's existing interpolation
 * text node. Keeping the same Text object is required for hydration and for
 * later Angular checks to remain valid.
 * @internal
 */
export function ɵsxTextNode(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  source: DependencySource<unknown>,
  textIndex = 0,
): void {
  table.bind(slot, source, writeText(boundTextNode(target, textIndex)), equalText);
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

/** Compiler instruction: reactive expression bound to Angular's text node. @internal */
export function ɵsxTextExpressionNode(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  sources: readonly DependencySource<unknown>[],
  read: () => unknown,
  textIndex = 0,
): void {
  table.bindExpression(
    slot,
    sources,
    read,
    writeText(boundTextNode(target, textIndex)),
    equalText,
  );
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

/** Compiler instruction: reactive expression bound to a DOM property. @internal */
export function ɵsxPropertyExpression<T>(
  table: SxBindingTable,
  slot: BindingSlot,
  target: object,
  property: string,
  sources: readonly DependencySource<unknown>[],
  read: () => T,
): void {
  table.bindExpression(slot, sources, read, writeProperty(target, property));
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

/** Compiler instruction: reactive expression bound to an attribute. @internal */
export function ɵsxAttributeExpression(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  attribute: string,
  sources: readonly DependencySource<unknown>[],
  read: () => unknown,
): void {
  table.bindExpression(
    slot,
    sources,
    read,
    writeAttribute(target, attribute),
  );
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

/** Compiler instruction: reactive expression bound to a class. @internal */
export function ɵsxClassExpression(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  className: string,
  sources: readonly DependencySource<unknown>[],
  read: () => unknown,
): void {
  table.bindExpression(
    slot,
    sources,
    read,
    writeClass(target, className),
    equalClass,
  );
}

/** Compiler instruction: direct reactive class-map binding. @internal */
export function ɵsxClassMap(
  table: SxBindingTable,
  slot: BindingSlot,
  target: Element,
  source: DependencySource<SxClassMap | null | undefined>,
): void {
  table.bind(slot, source, writeClassMap(target));
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

/** Compiler instruction: reactive expression bound to a style property. @internal */
export function ɵsxStyleExpression(
  table: SxBindingTable,
  slot: BindingSlot,
  target: HTMLElement,
  property: string,
  sources: readonly DependencySource<unknown>[],
  read: () => unknown,
): void {
  table.bindExpression(
    slot,
    sources,
    read,
    writeStyle(target, property),
  );
}

/**
 * Compiler instruction: direct event listener.
 *
 * Server rendering attaches nothing: the markup is identical without it, and
 * hydration mounts the client view that installs the listeners.
 * @internal
 */
export function ɵsxListener(
  table: SxBindingTable,
  slot: BindingSlot,
  target: EventTarget,
  type: string,
  handler: (event: any) => void,
  options?: AddEventListenerOptions,
  server = false,
): void {
  if (server) {
    return;
  }

  table.bindListener(slot, target, type, handler, options);
}

/** Compiler instruction: direct reactive style-map binding. @internal */
export function ɵsxStyleMap(
  table: SxBindingTable,
  slot: BindingSlot,
  target: HTMLElement,
  source: DependencySource<SxStyleMap | null | undefined>,
): void {
  table.bind(slot, source, writeStyleMap(target));
}
