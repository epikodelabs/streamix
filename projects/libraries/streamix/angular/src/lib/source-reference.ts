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
 * fields and observes plain-field identity replacement.
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

    if (Object.prototype.hasOwnProperty.call(context, field)) {
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
  // overwrite an eager accessor, so install any still-missing observers only
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
  const descriptor = Object.getOwnPropertyDescriptor(target, field);

  if (descriptor && !descriptor.configurable) {
    throw new Error(
      `Cannot observe sx source reference ${JSON.stringify(field)} because the component field is not configurable.`,
    );
  }

  if (descriptor && (descriptor.get || descriptor.set)) {
    // Compiler metadata is intended to identify fields. Preserve authored
    // accessor semantics rather than wrapping them implicitly.
    return { restore() {} };
  }

  let current = target[field];
  const enumerable = descriptor?.enumerable ?? true;
  const writable = descriptor?.writable ?? true;

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
        configurable: descriptor?.configurable ?? true,
        enumerable,
        writable,
        value: current,
      });
    },
  };
}
