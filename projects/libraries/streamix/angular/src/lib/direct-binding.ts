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

  let pending = writer.read(source);
  let rendered = pending;
  let subscription: Subscription | undefined;
  let scheduled: ScheduledBinding | undefined;
  let destroyed = false;

  writer.write(rendered);

  scheduled = scheduler.register(() => {
    if (destroyed || equal(rendered, pending)) {
      return;
    }

    rendered = pending;
    writer.write(rendered);
  });

  let subscribing = true;
  subscription = source.subscribe((value) => {
    if (subscribing) return;
    pending = value;
    scheduled?.markDirty();
  });
  subscribing = false;

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
 * null / undefined / false remove the attribute. `true` writes an empty
 * attribute; all other values are stringified.
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