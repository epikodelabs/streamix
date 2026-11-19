import type {
  DependencySource,
  Subscription,
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
import { combineSubscriptions, readSourceState, subscribeSourceError, viewValue } from './view-value';
import { getSxRenderErrorSink } from './error-delivery';

/**
 * Handle returned by a direct renderer binding.
 */
export interface DirectBinding {
  destroy(): void;
}

/**
 * Options shared by direct renderer bindings.
 */
export interface DirectBindingOptions {
  /**
   * Renderer scheduler used for reactive emissions.
   *
   * Initial rendering is always synchronous.
   */
  scheduler?: RendererScheduler;
}

interface BindingWriter<T> {
  read(source: DependencySource<T>): T;
  write(value: T): void;
  equal?(previous: T, next: T): boolean;
}

/**
 * Shared low-level binding primitive used by all concrete DOM bindings.
 *
 * There are no Angular view operations in this path.
 */
function bindDirect<T>(
  source: DependencySource<T>,
  writer: BindingWriter<T>,
  options: DirectBindingOptions,
): DirectBinding {
  const scheduler = options.scheduler ?? rendererScheduler;
  const equal = writer.equal ?? Object.is;

  // Delivery contract (React/Vue parity): a failed source delivers at setup;
  // pending and completed sources bind undefined.
  const state = readSourceState(source);
  if (state.status === "failed") throw state.error;
  let pending = (state.status === "value" ? viewValue(state.value) : undefined) as T;
  let rendered = pending;
  /** Stored failure delivered by the next flush; cleared by a good emission. */
  let failure: { error: unknown } | undefined;
  let subscription: Subscription | undefined;
  let scheduled: ScheduledBinding | undefined;
  let destroyed = false;

  writer.write(rendered);

  scheduled = scheduler.register(() => {
    if (destroyed) {
      return;
    }

    if (failure) {
      getSxRenderErrorSink()(failure.error);
      return;
    }

    if (equal(rendered, pending)) {
      return;
    }

    rendered = pending;
    writer.write(rendered);
  });

  let subscribing = true;
  subscription = source.subscribe((value) => {
    if (subscribing) return;
    // A successful emission clears a stored failure: the binding recovers in
    // place on the next flush.
    failure = undefined;
    pending = viewValue(value);
    scheduled?.markDirty();
  });
  subscribing = false;
  // fail() never notifies value subscribers; failures reach the binding only
  // through onError.
  const errorSubscription = subscribeSourceError(source, error => {
    if (destroyed) return;
    failure = { error };
    scheduled?.markDirty();
  });
  subscription = combineSubscriptions(subscription, errorSubscription);

  return {
    destroy(): void {
      if (destroyed) {
        return;
      }

      destroyed = true;
      scheduled?.destroy();
      scheduled = undefined;

      const teardown = subscription;
      subscription = undefined;
      teardown?.();
    },
  };
}

/**
 * Directly binds a reactive source to a DOM node's text content.
 */
export function bindText(
  source: DependencySource<unknown>,
  target: Node,
  options: DirectBindingOptions = {},
): DirectBinding {
  return bindDirect(source, {
    read: current => current.value,
    write: writeText(target),
    equal: equalText,
  }, options);
}

/**
 * Directly binds a reactive source to a DOM property.
 */
export function bindProperty<T>(
  source: DependencySource<T>,
  target: object,
  property: string,
  options: DirectBindingOptions = {},
): DirectBinding {
  return bindDirect(source, {
    read: current => current.value,
    write: writeProperty(target, property),
  }, options);
}

/**
 * Directly binds a reactive source to an element attribute.
 *
 * Mirrors Angular's `[attr.name]` binding: nullish values remove the
 * attribute and every other value is stringified, including booleans. Use
 * `bindClass` or a DOM property binding for presence semantics.
 */
export function bindAttribute(
  source: DependencySource<unknown>,
  target: Element,
  attribute: string,
  options: DirectBindingOptions = {},
): DirectBinding {
  return bindDirect(source, {
    read: current => current.value,
    write: writeAttribute(target, attribute),
  }, options);
}

/**
 * Directly toggles one CSS class from a reactive truthy/falsy source.
 */
export function bindClass(
  source: DependencySource<unknown>,
  target: Element,
  className: string,
  options: DirectBindingOptions = {},
): DirectBinding {
  return bindDirect(source, {
    read: current => current.value,
    write: writeClass(target, className),
    equal: equalClass,
  }, options);
}


/**
 * Directly binds a reactive class map.
 *
 * The map is diffed against the previously rendered map. Missing keys are
 * removed while unrelated classes remain untouched.
 */
export function bindClassMap(
  source: DependencySource<SxClassMap | null | undefined>,
  target: Element,
  options: DirectBindingOptions = {},
): DirectBinding {
  return bindDirect(source, {
    read: current => current.value,
    write: writeClassMap(target),
  }, options);
}

/**
 * Directly binds one inline style property.
 *
 * null / undefined / false remove the property. Other values are stringified.
 */
export function bindStyle(
  source: DependencySource<unknown>,
  target: HTMLElement,
  property: string,
  options: DirectBindingOptions = {},
): DirectBinding {
  return bindDirect(source, {
    read: current => current.value,
    write: writeStyle(target, property),
  }, options);
}

/**
 * Directly binds a reactive style map.
 *
 * The map is diffed against the previously rendered map. Keys removed from the
 * next value are removed from the element, while unrelated inline styles remain
 * untouched.
 */
export function bindStyleMap(
  source: DependencySource<SxStyleMap | null | undefined>,
  target: HTMLElement,
  options: DirectBindingOptions = {},
): DirectBinding {
  return bindDirect(source, {
    read: current => current.value,
    write: writeStyleMap(target),
  }, options);
}

export type { SxClassMap, SxStyleMap } from './binding-writers';
