import {
  DestroyRef,
  afterNextRender,
  inject,
} from '@angular/core';
import {
  createSubscription,
  type Subscription,
} from '@epikodelabs/streamix';

/**
 * Compiler/runtime bridge for one component field that stores a reactive
 * source identity.
 *
 * @internal
 */
export interface SxSourceReference<T = unknown> {
  subscribe(callback: (source: T) => void): Subscription;
}

/** @internal */
export type SxSourceReferenceMap = Readonly<
  Record<string, SxSourceReference<unknown>>
>;

class SourceReferenceCell implements SxSourceReference<unknown> {
  private readonly subscribers = new Set<(source: unknown) => void>();

  subscribe(callback: (source: unknown) => void): Subscription {
    this.subscribers.add(callback);
    return createSubscription(() => {
      this.subscribers.delete(callback);
    });
  }

  emit(source: unknown): void {
    for (const subscriber of [...this.subscribers]) {
      subscriber(source);
    }
  }

  clear(): void {
    this.subscribers.clear();
  }
}

interface InstalledFieldObserver {
  restore(): void;
}

/**
 * Creates compiler-owned source-reference channels for selected component
 * fields and observes field identity replacement for plain fields and for
 * authored accessors.
 *
 * The helper is safe when emitted before authored class fields: fields that do
 * not exist yet are installed after the first browser render. A source bridge
 * that inserts this initializer after authored fields gets immediate
 * observation during construction.
 *
 * @internal
 */
export function ɵinstallSxSourceReferences<T extends object>(
  context: T,
  fields: readonly string[],
): SxSourceReferenceMap {
  const destroyRef = inject(DestroyRef);
  const cells = Object.create(null) as Record<string, SourceReferenceCell>;
  const installed = new Map<string, InstalledFieldObserver>();
  let destroyed = false;

  for (const field of uniqueFields(fields)) {
    cells[field] = new SourceReferenceCell();

    // Plain fields must exist before they can be observed: installing early
    // would be overwritten by class-field initialization. Prototype
    // accessors, in contrast, are installed when the class is defined, so
    // they are observed eagerly like existing plain fields.
    if (
      Object.prototype.hasOwnProperty.call(context, field) ||
      findInheritedAccessorDescriptor(context, field) !== undefined
    ) {
      installed.set(
        field,
        installPlainFieldObserver(
          context,
          field,
          value => cells[field].emit(value),
        ),
      );
    }
  }

  // A conservative string source transform may place the generated field
  // before authored component fields. Class-field initialization would then
  // overwrite an eager observer, so install any still-missing observers only
  // after construction/render has completed.
  if (installed.size < Object.keys(cells).length) {
    afterNextRender(() => {
      if (destroyed) {
        return;
      }

      for (const field of Object.keys(cells)) {
        if (installed.has(field)) {
          continue;
        }

        installed.set(
          field,
          installPlainFieldObserver(
            context,
            field,
            value => cells[field].emit(value),
          ),
        );
      }
    });
  }

  destroyRef.onDestroy(() => {
    destroyed = true;

    for (const observer of installed.values()) {
      observer.restore();
    }
    installed.clear();

    for (const cell of Object.values(cells)) {
      cell.clear();
    }
  });

  return cells;
}

function uniqueFields(fields: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    if (!/^[A-Za-z_$][\w$]*$/.test(field) || seen.has(field)) {
      continue;
    }

    seen.add(field);
    result.push(field);
  }

  return result;
}

function installPlainFieldObserver<T extends object>(
  context: T,
  field: string,
  onChange: (value: unknown) => void,
): InstalledFieldObserver {
  const target = context as unknown as Record<string, unknown>;
  const ownDescriptor = Object.getOwnPropertyDescriptor(target, field);

  if (ownDescriptor && !ownDescriptor.configurable) {
    throw new Error(
      `Cannot observe sx source reference ${JSON.stringify(field)} because the component field is not configurable.`,
    );
  }

  // Authored `get x() {}` class bodies declare accessors on the prototype,
  // while host code can define accessors as own properties. Either shape can
  // carry a compiler-selected source reference, so both are wrapped with a
  // delegating observer. Skipping accessors would leave the field unobserved
  // and compiled views permanently bound to the initial source.
  const accessorDescriptor =
    ownDescriptor ?? findInheritedAccessorDescriptor(target, field);

  if (accessorDescriptor && (accessorDescriptor.get || accessorDescriptor.set)) {
    return installAccessorObserver(
      context,
      field,
      accessorDescriptor,
      ownDescriptor === undefined,
      onChange,
    );
  }

  let current = target[field];
  const enumerable = ownDescriptor?.enumerable ?? true;
  const writable = ownDescriptor?.writable ?? true;

  Object.defineProperty(target, field, {
    configurable: true,
    enumerable,
    get(): unknown {
      return current;
    },
    set(next: unknown): void {
      if (!writable) {
        throw new TypeError(
          `Cannot assign to readonly sx source reference ${JSON.stringify(field)}.`,
        );
      }

      if (Object.is(current, next)) {
        return;
      }

      current = next;
      onChange(next);
    },
  });

  return {
    restore(): void {
      Object.defineProperty(target, field, {
        configurable: ownDescriptor?.configurable ?? true,
        enumerable,
        writable,
        value: current,
      });
    },
  };
}

function findInheritedAccessorDescriptor(
  target: object,
  field: string,
): PropertyDescriptor | undefined {
  let prototype = Object.getPrototypeOf(target);

  while (prototype && prototype !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, field);

    if (descriptor) {
      return descriptor.get || descriptor.set ? descriptor : undefined;
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return undefined;
}

function installAccessorObserver<T extends object>(
  context: T,
  field: string,
  descriptor: PropertyDescriptor,
  inherited: boolean,
  onChange: (value: unknown) => void,
): InstalledFieldObserver {
  const target = context as unknown as Record<string, unknown>;
  const { get, set } = descriptor;

  // Identity replacement is reported against the value the authored getter
  // reports after the authored setter runs: the setter may normalize or
  // ignore an assignment. An initial read establishes the baseline so only
  // real identity changes are emitted; a getter that is not readable yet
  // defers the baseline instead of throwing from installation.
  let lastEmitted: unknown;
  let hasEmitted = false;

  try {
    if (get) {
      lastEmitted = get.call(target);
      hasEmitted = true;
    }
  } catch {
    hasEmitted = false;
  }

  const emitIdentityChange = (value: unknown): void => {
    if (hasEmitted && Object.is(lastEmitted, value)) {
      return;
    }

    hasEmitted = true;
    lastEmitted = value;
    onChange(value);
  };

  Object.defineProperty(target, field, {
    configurable: true,
    enumerable: descriptor.enumerable,
    ...(get
      ? {
          get(this: unknown): unknown {
            return get.call(this);
          },
        }
      : {}),
    ...(set
      ? {
          set(this: unknown, next: unknown): void {
            set.call(this, next);

            if (get) {
              try {
                emitIdentityChange(get.call(this));
              } catch {
                // The authored getter is temporarily unreadable. Skip the
                // emission rather than turning the authored setter into a
                // throwing one; the next readable assignment reports the
                // identity change.
                return;
              }
            } else {
              emitIdentityChange(next);
            }
          },
        }
      : {}),
  });

  return {
    restore(): void {
      if (inherited) {
        // The wrapper was the only own property for this field: removing it
        // reveals the authored prototype accessor again.
        delete target[field];
        return;
      }

      Object.defineProperty(target, field, descriptor);
    },
  };
}
