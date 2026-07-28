import { atom, type Atom, type Subscription, type Writable } from "./reactive-state";

export type { Atom, Subscription, Writable } from "./reactive-state";

/**
 * A keyed validation-result dictionary.
 *
 * Library-created issue dictionaries have a null prototype; use
 * `Object.hasOwn()` rather than instance methods such as `hasOwnProperty()`.
 */
export type ValidationIssues = Readonly<Record<string, unknown>>;
export type MaybePromise<T> = T | PromiseLike<T>;
export type Check<T> = (value: T) => ValidationIssues | null;
export type AsyncCheck<T> = (
  value: T,
  signal: AbortSignal,
) => MaybePromise<ValidationIssues | null>;
export type FormStatus = "valid" | "invalid" | "pending" | "disabled" | "error";

export interface ResetOptions {
  updateInitial?: boolean;
}

export interface WriteOptions {
  touch?: boolean;
}

export interface DisableOptions {
  /** Change only this group or list, leaving its descendants unchanged. */
  onlySelf?: boolean;
}

export interface GroupOptions {
  /**
   * Disposes children when this container is disposed or removes them.
   *
   * Children remain exclusively attached to this container while present,
   * even when this option is `false`.
   */
  ownsChildren?: boolean;
  disabled?: boolean;
}

export interface FieldOptions<T> {
  checks?: Check<T> | readonly Check<T>[];
  asyncChecks?: AsyncCheck<T> | readonly AsyncCheck<T>[];
  disabled?: boolean;
  asyncOnlyWhenSyncClean?: boolean;
  asyncDelay?: number;
  validateInitial?: boolean;
  /**
   * Optionally converts an asynchronous validator failure.
   *
   * Return issues to report an invalid field, `null` to suppress the failure,
   * or `undefined` to preserve it as a validation error.
   */
  asyncFailureToIssues?: (
    error: unknown,
  ) => ValidationIssues | null | undefined;
}

export interface FieldValidationSource<T> {
  checks?: Check<T> | readonly Check<T>[];
  asyncChecks?: AsyncCheck<T> | readonly AsyncCheck<T>[];
  asyncOnlyWhenSyncClean?: boolean;
  asyncDelay?: number;
}

export interface FormOptions<T extends NodeMap> extends GroupOptions {
  checks?: Check<FormCompleteValue<T>> | readonly Check<FormCompleteValue<T>>[];
}

export interface FormValidationSource<T> {
  checks?: Check<T> | readonly Check<T>[];
}

/** Read-only projection of a form-state value. */
export interface StateProjection<T> {
  readonly value: T;
  readonly previous: T;
  readonly disposed: boolean;
  readonly error?: unknown;

  subscribe(
    callback: (value: T, previous: T) => MaybePromise<void>,
  ): Subscription;
}

/** Writable projection exposed only for field values and disabled state. */
export interface WritableStateProjection<T> extends StateProjection<T> {
  set(value: T): void;
  next(value: T): void;
}

export interface NodeState<Value, CompleteValue = Value> {
  readonly value: Value;
  readonly completeValue: CompleteValue;
  readonly issues: ValidationIssues | null;
  readonly validationError: unknown | null;
  readonly status: FormStatus;
  /** True for both `valid` and `disabled` statuses. */
  readonly valid: boolean;
  readonly invalid: boolean;
  readonly pending: boolean;
  readonly dirty: boolean;
  readonly touched: boolean;
  readonly disabled: boolean;
}

export interface FormNode<Value, CompleteValue = Value> {
  readonly kind: "field" | "form" | "list";

  /**
   * Internal reactive state. Prefer the projected public views such as
   * `value`, `status`, and `touched` in application code.
   */
  readonly state: Atom<NodeState<Value, CompleteValue>>;

  readonly value: StateProjection<Value>;
  readonly completeValue: StateProjection<CompleteValue>;
  readonly issues: StateProjection<ValidationIssues | null>;
  readonly validationError: StateProjection<unknown | null>;
  readonly status: StateProjection<FormStatus>;
  readonly valid: StateProjection<boolean>;
  readonly invalid: StateProjection<boolean>;
  readonly pending: StateProjection<boolean>;
  readonly dirty: StateProjection<boolean>;
  readonly touched: StateProjection<boolean>;
  readonly disabled: WritableStateProjection<boolean>;

  set(value: CompleteValue, options?: WriteOptions): void;

  reset(): void;
  reset(value: CompleteValue, options?: ResetOptions): void;

  touch(): void;
  untouch(): void;
  enable(options?: DisableOptions): void;
  disable(options?: DisableOptions): void;
  dispose(): void;
}

export type NodeValue<N> = N extends FormNode<infer V, any> ? V : never;
export type NodeCompleteValue<N> = N extends FormNode<any, infer V> ? V : never;
export type NodeMap = Record<string, FormNode<any, any>>;
export type FormCompleteValue<T extends NodeMap> = {
  [K in keyof T]: NodeCompleteValue<T[K]>;
};
export type FormValue<T extends NodeMap> = Partial<{
  [K in keyof T]: NodeValue<T[K]>;
}>;

type Selector<S, T> = (state: S) => T;

function createView<S, T>(
  source: Atom<S>,
  select: Selector<S, T>,
): StateProjection<T> {
  return Object.freeze({
    get value(): T {
      return select(source.value);
    },

    get previous(): T {
      return select(source.previous ?? source.value);
    },

    get disposed(): boolean {
      return source.disposed;
    },

    get error(): unknown {
      return source.error;
    },

    subscribe(
      callback: (value: T, previous: T) => MaybePromise<void>,
    ): Subscription {
      let previous = select(source.value);

      return source.subscribe(async current => {
        const next = select(current);
        if (Object.is(next, previous)) return;

        const old = previous;
        previous = next;
        await callback(next, old);
      });
    },
  });
}

function createWritableView<S, T>(
  source: Writable<S>,
  select: Selector<S, T>,
  write: (value: T) => void,
): WritableStateProjection<T> {
  const projected = createView(source, select);

  return Object.freeze({
    get value(): T {
      return projected.value;
    },

    get previous(): T {
      return projected.previous;
    },

    get disposed(): boolean {
      return projected.disposed;
    },

    get error(): unknown {
      return projected.error;
    },

    subscribe: projected.subscribe.bind(projected),
    set: write,
    next: write,
  });
}

type StateProjections<S, K extends keyof S> = {
  readonly [P in K]: StateProjection<S[P]>;
};

function createStateProjections<
  S,
  const K extends readonly (keyof S)[],
>(
  source: Atom<S>,
  keys: K,
): StateProjections<S, K[number]> {
  return Object.freeze(
    Object.fromEntries(
      keys.map(key => [key, createView(source, state => state[key])]),
    ),
  ) as StateProjections<S, K[number]>;
}

const normalize = <T>(value?: T | readonly T[]): T[] =>
  value == null ? [] : Array.isArray(value) ? [...value] : [value as T];

function hasFieldValidationSource<T>(
  source: FieldValidationSource<T>,
): boolean {
  return source.checks !== undefined ||
    source.asyncChecks !== undefined ||
    source.asyncOnlyWhenSyncClean !== undefined ||
    source.asyncDelay !== undefined;
}

function resolveFieldValidation<T>(
  sources: ReadonlyMap<object, FieldValidationSource<T>>,
): {
  syncChecks: Check<T>[];
  asyncChecks: AsyncCheck<T>[];
  asyncOnlyWhenSyncClean: boolean;
  asyncDelay: number;
} {
  const syncChecks: Check<T>[] = [];
  const asyncChecks: AsyncCheck<T>[] = [];
  let asyncOnlyWhenSyncClean = true;
  let asyncDelay = 0;

  for (const source of sources.values()) {
    syncChecks.push(...normalize(source.checks));
    asyncChecks.push(...normalize(source.asyncChecks));

    if (source.asyncOnlyWhenSyncClean !== undefined) {
      asyncOnlyWhenSyncClean = source.asyncOnlyWhenSyncClean;
    }

    if (source.asyncDelay !== undefined) {
      asyncDelay = Math.max(0, source.asyncDelay);
    }
  }

  return {
    syncChecks,
    asyncChecks,
    asyncOnlyWhenSyncClean,
    asyncDelay,
  };
}

function resolveChecks<T>(
  sources: ReadonlyMap<
    object,
    Check<T> | readonly Check<T>[] | undefined
  >,
): Check<T>[] {
  const checks: Check<T>[] = [];

  for (const source of sources.values()) {
    checks.push(...normalize(source));
  }

  return checks;
}

const isEmpty = (value: unknown): boolean =>
  value == null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

function mergeIssues(
  ...sources: readonly (ValidationIssues | null | undefined)[]
): ValidationIssues | null {
  let result: Record<string, unknown> | undefined;

  for (const source of sources) {
    if (!source) continue;
    result ??= Object.create(null) as Record<string, unknown>;
    Object.assign(result, source);
  }

  return result ? Object.freeze(result) : null;
}

function statusOf(
  disabled: boolean,
  pending: boolean,
  issues: ValidationIssues | null,
  error: unknown | null,
): FormStatus {
  if (disabled) return "disabled";
  if (pending) return "pending";
  if (error !== null) return "error";
  if (issues !== null) return "invalid";
  return "valid";
}

function keyed(
  entries: readonly (readonly [PropertyKey, unknown])[],
): ValidationIssues | null {
  if (entries.length === 0) return null;

  const result: Record<PropertyKey, unknown> = Object.create(null) as Record<
    PropertyKey,
    unknown
  >;
  for (const [key, value] of entries) result[key] = value;

  return Object.freeze(result) as ValidationIssues;
}

function shallowEqualState(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(key => Object.is(left[key], right[key]));
}

function shallowEqualArray<T>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
}

function reuseRecord<T extends Record<string, unknown>>(
  previous: T,
  next: T,
): T {
  return shallowEqualState(previous, next) ? previous : next;
}

function reuseNullableRecord<T extends Record<string, unknown>>(
  previous: T | null,
  next: T | null,
): T | null {
  if (previous === null || next === null) return previous === next ? previous : next;
  return reuseRecord(previous, next);
}

function reuseArray<T>(previous: T[], next: T[]): T[] {
  return shallowEqualArray(previous, next) ? previous : next;
}

const nodeContainers = new WeakMap<FormNode<any, any>, object>();

function claimChildren(
  children: readonly FormNode<any, any>[],
  container: object,
): void {
  for (const child of children) {
    if (nodeContainers.has(child)) {
      throw new Error(
        "A form node cannot belong to more than one form container.",
      );
    }
  }

  children.forEach(child => nodeContainers.set(child, container));
}

function releaseChild(child: FormNode<any, any>, container: object): void {
  if (nodeContainers.get(child) === container) {
    nodeContainers.delete(child);
  }
}

function createRefreshScheduler(refresh: () => void) {
  let batchDepth = 0;
  let queued = false;

  const request = (): void => {
    if (batchDepth > 0) {
      queued = true;
      return;
    }

    refresh();
  };

  const batch = (work: () => void): void => {
    batchDepth++;

    try {
      work();
    } finally {
      batchDepth--;

      if (batchDepth === 0 && queued) {
        queued = false;
        refresh();
      }
    }
  };

  return { request, batch };
}

/* ── Field ────────────────────────────────────────────── */

export interface FieldState<T> extends NodeState<T> {
  readonly initialValue: T;
  readonly syncIssues: ValidationIssues | null;
  readonly asyncIssues: ValidationIssues | null;
}

export interface Field<T> extends FormNode<T> {
  readonly kind: "field";
  readonly state: Atom<FieldState<T>>;
  readonly value: WritableStateProjection<T>;
  readonly completeValue: WritableStateProjection<T>;
  readonly initialValue: StateProjection<T>;
  readonly syncIssues: StateProjection<ValidationIssues | null>;
  readonly asyncIssues: StateProjection<ValidationIssues | null>;

  useValidation(
    source: object,
    validation: FieldValidationSource<T>,
  ): void;
  clearValidation(source: object): void;
}

export function field<T>(
  initial: T,
  options: FieldOptions<T> = {},
): Field<T> {
  return createField(initial, options);
}

/**
 * Creates a field synchronized with a caller-owned writable Streamix atom.
 *
 * Field writes are forwarded to `source`, and external source updates are
 * validated and reflected by the field. Disposing the field never disposes
 * the source. The initial source value remains the field's reset baseline.
 */
export function bindField<T>(
  source: Writable<T>,
  options: FieldOptions<T> = {},
): Field<T> {
  return createField(source.value, options, source);
}

function createField<T>(
  initial: T,
  options: FieldOptions<T>,
  source?: Writable<T>,
): Field<T> {
  const validateInitial = options.validateInitial ?? true;
  const validationSources = new Map<object, FieldValidationSource<T>>();
  const builtInValidationSource = {};

  let disposed = false;
  let run = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sourceSubscription: Subscription | undefined;

  const builtInValidation: FieldValidationSource<T> = {
    checks: options.checks,
    asyncChecks: options.asyncChecks,
  };

  if (options.asyncOnlyWhenSyncClean !== undefined) {
    builtInValidation.asyncOnlyWhenSyncClean = options.asyncOnlyWhenSyncClean;
  }

  if (options.asyncDelay !== undefined) {
    builtInValidation.asyncDelay = options.asyncDelay;
  }

  if (hasFieldValidationSource(builtInValidation)) {
    validationSources.set(builtInValidationSource, builtInValidation);
  }

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Cannot mutate a disposed field.");
    }
  };

  const runSync = (
    value: T,
    disabled: boolean,
  ): {
    issues: ValidationIssues | null;
    error: unknown | null;
  } => {
    if (disabled) return { issues: null, error: null };

    try {
      const activeValidation = resolveFieldValidation(validationSources);

      return {
        issues: mergeIssues(
          ...activeValidation.syncChecks.map(check => check(value)),
        ),
        error: null,
      };
    } catch (error) {
      return { issues: null, error };
    }
  };

  const firstSync = runSync(initial, options.disabled ?? false);
  const firstStatus = statusOf(
    options.disabled ?? false,
    false,
    firstSync.issues,
    firstSync.error,
  );

  const state = atom<FieldState<T>>({
    value: initial,
    completeValue: initial,
    initialValue: initial,

    syncIssues: firstSync.issues,
    asyncIssues: null,
    issues: firstSync.issues,
    validationError: firstSync.error,

    status: firstStatus,
    valid: firstStatus === "valid" || firstStatus === "disabled",
    invalid: firstStatus === "invalid",
    pending: false,
    dirty: false,
    touched: false,
    disabled: options.disabled ?? false,
  });

  const publish = (patch: Partial<FieldState<T>>): void => {
    if (disposed) return;

    const current = state.value;
    const candidate = { ...current, ...patch };
    const calculatedIssues = candidate.disabled
      ? null
      : mergeIssues(candidate.syncIssues, candidate.asyncIssues);
    const issues = reuseNullableRecord(current.issues, calculatedIssues);

    const status = statusOf(
      candidate.disabled,
      candidate.pending,
      issues,
      candidate.validationError,
    );

    const next: FieldState<T> = {
      ...candidate,
      completeValue: candidate.value,
      issues,
      status,
      valid: status === "valid" || status === "disabled",
      invalid: status === "invalid",
      dirty: !Object.is(candidate.value, candidate.initialValue),
    };

    if (
      shallowEqualState(
        current as unknown as Record<string, unknown>,
        next as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }

    state.set(next);
  };

  const cancelAsync = (clearPending = true): void => {
    run++;
    controller?.abort();
    controller = undefined;

    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (clearPending && state.value.pending) {
      publish({ pending: false });
    }
  };

  const executeAsync = async (): Promise<void> => {
    if (disposed) return;

    cancelAsync(false);
    const snapshot = state.value;
    const activeValidation = resolveFieldValidation(validationSources);

    if (
      snapshot.disabled ||
      activeValidation.asyncChecks.length === 0 ||
      snapshot.validationError !== null ||
      (
        activeValidation.asyncOnlyWhenSyncClean &&
        snapshot.syncIssues !== null
      )
    ) {
      publish({ pending: false, asyncIssues: null });
      return;
    }

    const currentRun = run;
    const currentController = new AbortController();
    controller = currentController;

    publish({ pending: true, validationError: null });

    try {
      const results = await Promise.all(
        activeValidation.asyncChecks.map(check =>
          Promise.resolve(check(snapshot.value, currentController.signal)),
        ),
      );

      if (
        disposed ||
        currentController.signal.aborted ||
        currentRun !== run
      ) {
        return;
      }

      publish({
        asyncIssues: mergeIssues(...results),
        validationError: null,
      });
    } catch (error) {
      if (
        disposed ||
        currentController.signal.aborted ||
        currentRun !== run
      ) {
        return;
      }

      let converted: ValidationIssues | null | undefined;

      try {
        converted = options.asyncFailureToIssues?.(error);
      } catch (conversionError) {
        publish({ validationError: conversionError, asyncIssues: null });
        return;
      }

      publish(
        converted === undefined
          ? { validationError: error, asyncIssues: null }
          : { validationError: null, asyncIssues: converted },
      );
    } finally {
      if (!disposed && currentRun === run) {
        controller = undefined;
        publish({ pending: false });
      }
    }
  };

  const scheduleAsync = (): void => {
    if (disposed) return;

    cancelAsync(false);

    const current = state.value;
    const activeValidation = resolveFieldValidation(validationSources);

    if (
      activeValidation.asyncChecks.length === 0 ||
      current.disabled ||
      current.validationError !== null ||
      (
        activeValidation.asyncOnlyWhenSyncClean &&
        current.syncIssues !== null
      )
    ) {
      if (current.pending) publish({ pending: false });
      return;
    }

    if (activeValidation.asyncDelay === 0) {
      void executeAsync();
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      void executeAsync();
    }, activeValidation.asyncDelay);
  };

  const revalidate = (): void => {
    if (disposed) return;

    const current = state.value;
    const sync = runSync(current.value, current.disabled);

    publish({
      syncIssues: sync.issues,
      asyncIssues: null,
      validationError: sync.error,
      pending: current.pending,
    });

    scheduleAsync();
  };

  const applyValue = (
    value: T,
    writeOptions: WriteOptions = {},
  ): void => {
    assertActive();
    const current = state.value;
    const sync = runSync(value, current.disabled);

    publish({
      value,
      touched: writeOptions.touch ? true : current.touched,
      syncIssues: sync.issues,
      asyncIssues: null,
      validationError: sync.error,
      pending: current.pending,
    });

    scheduleAsync();
  };

  const writeValue = (
    value: T,
    writeOptions: WriteOptions = {},
  ): void => {
    applyValue(value, writeOptions);

    if (source && !Object.is(source.value, value)) {
      source.set(value);
    }
  };

  const setDisabled = (disabled: boolean): void => {
    assertActive();
    if (state.value.disabled === disabled) return;

    const sync = runSync(state.value.value, disabled);

    publish({
      disabled,
      syncIssues: sync.issues,
      asyncIssues: null,
      validationError: sync.error,
      pending: false,
    });

    scheduleAsync();
  };

  const value = createWritableView(state, current => current.value, writeValue);
  const completeValue = createWritableView(
    state,
    current => current.completeValue,
    writeValue,
  );
  const {
    initialValue,
    syncIssues,
    asyncIssues,
    issues,
    validationError,
    status,
    valid,
    invalid,
    pending,
    dirty,
    touched,
  } = createStateProjections(state, [
    "initialValue",
    "syncIssues",
    "asyncIssues",
    "issues",
    "validationError",
    "status",
    "valid",
    "invalid",
    "pending",
    "dirty",
    "touched",
  ]);
  const disabled = createWritableView(
    state,
    current => current.disabled,
    setDisabled,
  );

  function reset(): void;
  function reset(next: T, resetOptions?: ResetOptions): void;
  function reset(
    next?: T,
    resetOptions: ResetOptions = {},
  ): void {
    assertActive();
    const supplied = arguments.length > 0;
    const current = state.value;
    const value = supplied ? (next as T) : current.initialValue;
    const initialValue =
      supplied && resetOptions.updateInitial
        ? value
        : current.initialValue;

    const sync = runSync(value, current.disabled);

    cancelAsync(false);

    publish({
      value,
      initialValue,
      touched: false,
      pending: current.pending,
      syncIssues: sync.issues,
      asyncIssues: null,
      validationError: sync.error,
    });

    scheduleAsync();

    if (source && !Object.is(source.value, value)) {
      source.set(value);
    }
  }

  if (validateInitial) scheduleAsync();

  if (source) {
    sourceSubscription = source.subscribe(next => {
      if (disposed || Object.is(state.value.value, next)) return;
      applyValue(next);
    });
  }

  return {
    kind: "field",
    state,

    value,
    completeValue,
    initialValue,
    syncIssues,
    asyncIssues,
    issues,
    validationError,
    status,
    valid,
    invalid,
    pending,
    dirty,
    touched,
    disabled,

    set: writeValue,
    reset,

    touch(): void {
      assertActive();
      if (!state.value.touched) publish({ touched: true });
    },

    untouch(): void {
      assertActive();
      if (state.value.touched) publish({ touched: false });
    },

    enable(): void {
      setDisabled(false);
    },

    disable(): void {
      setDisabled(true);
    },

    useValidation(
      validationSource: object,
      validation: FieldValidationSource<T>,
    ): void {
      assertActive();
      validationSources.set(validationSource, validation);
      revalidate();
    },

    clearValidation(validationSource: object): void {
      assertActive();
      if (!validationSources.delete(validationSource)) return;
      revalidate();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAsync(false);

      try {
        void sourceSubscription?.();
      } finally {
        sourceSubscription = undefined;
        state.dispose();
      }
    },
  };
}

/* ── Shared group aggregation ─────────────────────────── */

interface GroupAggregate<Value, CompleteValue>
  extends NodeState<Value, CompleteValue> {}

function aggregateChildren<
  Value,
  CompleteValue,
>(
  children: readonly FormNode<any, any>[],
  disabled: boolean,
  buildValues: (
    children: readonly FormNode<any, any>[],
  ) => {
    value: Value;
    completeValue: CompleteValue;
  },
  ownIssues: ValidationIssues | null = null,
  ownError: unknown | null = null,
  selfTouched = false,
  keyForChild: (child: FormNode<any, any>, index: number) => PropertyKey =
    (_, index) => index,
): GroupAggregate<Value, CompleteValue> {
  const issueEntries: Array<readonly [PropertyKey, unknown]> = [];
  const errorEntries: Array<readonly [PropertyKey, unknown]> = [];

  let pending = false;
  let dirty = false;
  let touched = selfTouched;

  children.forEach((child, index) => {
    const key = keyForChild(child, index);

    if (child.issues.value !== null) {
      issueEntries.push([key, child.issues.value]);
    }

    if (child.validationError.value !== null) {
      errorEntries.push([key, child.validationError.value]);
    }

    pending ||= child.pending.value;
    dirty ||= child.dirty.value;
    touched ||= child.touched.value;
  });

  if (ownIssues) issueEntries.push(["$form", ownIssues]);
  if (ownError !== null) errorEntries.push(["$form", ownError]);

  const issues = disabled ? null : keyed(issueEntries);
  const validationError = disabled ? null : keyed(errorEntries);
  const status = statusOf(
    disabled,
    !disabled && pending,
    issues,
    validationError,
  );

  const values = buildValues(children);

  return {
    value: values.value,
    completeValue: values.completeValue,
    issues,
    validationError,
    status,
    valid: status === "valid" || status === "disabled",
    invalid: status === "invalid",
    pending: !disabled && pending,
    dirty,
    touched,
    disabled,
  };
}

/* ── Form ─────────────────────────────────────────────── */

export interface Form<T extends NodeMap>
  extends FormNode<FormValue<T>, FormCompleteValue<T>> {
  readonly kind: "form";
  readonly fields: Readonly<T>;

  patch(
    value: Partial<FormCompleteValue<T>>,
    options?: WriteOptions,
  ): void;
  useChecks(
    source: object,
    checks?: Check<FormCompleteValue<T>> | readonly Check<FormCompleteValue<T>>[],
  ): void;
  clearChecks(source: object): void;
}

export function form<T extends NodeMap>(
  fields: T,
  options: FormOptions<T> = {},
): Form<T> {
  const children = Object.freeze({ ...fields }) as Readonly<T>;
  const childEntries = Object.entries(children);
  const childNodes = childEntries.map(([, child]) => child);
  const container = {};

  if (new Set(childNodes).size !== childNodes.length) {
    throw new Error("A form node cannot appear in the same form twice.");
  }

  if (Object.hasOwn(children, "$form")) {
    throw new Error('"$form" is reserved for form-level validation issues.');
  }

  claimChildren(childNodes, container);

  const subscriptions: Subscription[] = [];
  let disposeState: (() => void) | undefined;
  let restoreChildren: (() => void) | undefined;

  try {
  const ownsChildren = options.ownsChildren ?? true;
  const checkSources = new Map<
    object,
    Check<FormCompleteValue<T>> | readonly Check<FormCompleteValue<T>>[] | undefined
  >();
  const builtInCheckSource = {};

  if (options.checks !== undefined) {
    checkSources.set(builtInCheckSource, options.checks);
  }

  let disposed = false;
  let selfTouched = false;

  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Cannot mutate a disposed form.");
    }
  };

  const calculate = (
    disabled: boolean,
  ): NodeState<FormValue<T>, FormCompleteValue<T>> => {
    const completeValue: Record<string, unknown> = {};

    for (const [key, child] of childEntries) {
      completeValue[key] = child.completeValue.value;
    }

    let ownIssues: ValidationIssues | null = null;
    let ownError: unknown | null = null;
    const formChecks = resolveChecks(checkSources);

    if (!disabled && formChecks.length > 0) {
      try {
        ownIssues = mergeIssues(
          ...formChecks.map(check =>
            check(completeValue as FormCompleteValue<T>),
          ),
        );
      } catch (error) {
        ownError = error;
      }
    }

    return aggregateChildren(
      childNodes,
      disabled,
      () => {
        const value: Record<string, unknown> = {};

        for (const [key, child] of childEntries) {
          if (!child.disabled.value) value[key] = child.value.value;
        }

        return {
          value: (disabled ? {} : value) as FormValue<T>,
          completeValue: completeValue as FormCompleteValue<T>,
        };
      },
      ownIssues,
      ownError,
      selfTouched,
      (_, index) => childEntries[index][0],
    );
  };

  const state = atom(calculate(options.disabled ?? false));
  disposeState = () => state.dispose();

  const refreshNow = (disabled = state.value.disabled): void => {
    if (disposed) return;

    const current = state.value;
    const calculated = calculate(disabled);
    const next: NodeState<FormValue<T>, FormCompleteValue<T>> = {
      ...calculated,
      value: reuseRecord(
        current.value as Record<string, unknown>,
        calculated.value as Record<string, unknown>,
      ) as FormValue<T>,
      completeValue: reuseRecord(
        current.completeValue as Record<string, unknown>,
        calculated.completeValue as Record<string, unknown>,
      ) as FormCompleteValue<T>,
      issues: reuseNullableRecord(
        current.issues,
        calculated.issues,
      ),
      validationError: reuseNullableRecord(
        current.validationError as Record<string, unknown> | null,
        calculated.validationError as Record<string, unknown> | null,
      ),
    };

    if (
      shallowEqualState(
        current as unknown as Record<string, unknown>,
        next as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }

    state.set(next);
  };

  const scheduler = createRefreshScheduler(() => refreshNow());
  const disabledByParent = new Set<FormNode<any, any>>();

  const disableChildren = (): void => {
    childNodes.forEach(child => {
      if (!child.disabled.value) {
        disabledByParent.add(child);
        child.disable();
      }
    });
  };

  const enableChildren = (): void => {
    disabledByParent.forEach(child => {
      if (child.disabled.value) child.enable();
    });
    disabledByParent.clear();
  };
  restoreChildren = enableChildren;

  childNodes.forEach(child => {
    subscriptions.push(child.state.subscribe(() => scheduler.request()));
  });

  const setDisabled = (disabled: boolean): void => {
    assertActive();
    if (state.value.disabled === disabled) return;
    refreshNow(disabled);
  };

  const {
    value,
    completeValue,
    issues,
    validationError,
    status,
    valid,
    invalid,
    pending,
    dirty,
    touched,
  } = createStateProjections(state, [
    "value",
    "completeValue",
    "issues",
    "validationError",
    "status",
    "valid",
    "invalid",
    "pending",
    "dirty",
    "touched",
  ]);
  const disabled = createWritableView(
    state,
    current => current.disabled,
    next => {
      if (next) disable();
      else enable();
    },
  );

  const set = (
    next: FormCompleteValue<T>,
    writeOptions: WriteOptions = {},
  ): void => {
    assertActive();
    scheduler.batch(() => {
      for (const key of Object.keys(children) as Array<keyof T>) {
        if (Object.hasOwn(next, key)) {
          children[key].set(next[key], writeOptions);
        }
      }
    });
  };

  const patch = (
    next: Partial<FormCompleteValue<T>>,
    writeOptions: WriteOptions = {},
  ): void => {
    assertActive();
    scheduler.batch(() => {
      for (const key of Object.keys(next) as Array<keyof T>) {
        if (Object.hasOwn(children, key)) {
          children[key].set(next[key]!, writeOptions);
        }
      }
    });
  };

  function reset(): void;
  function reset(
    next: FormCompleteValue<T>,
    resetOptions?: ResetOptions,
  ): void;
  function reset(
    next?: FormCompleteValue<T>,
    resetOptions: ResetOptions = {},
  ): void {
    assertActive();
    const supplied = arguments.length > 0;

    scheduler.batch(() => {
      const wasTouched = selfTouched;
      selfTouched = false;

      for (const key of Object.keys(children) as Array<keyof T>) {
        if (supplied && Object.hasOwn(next!, key)) {
          children[key].reset(
            (next as FormCompleteValue<T>)[key],
            resetOptions,
          );
        } else {
          children[key].reset();
        }
      }

      if (wasTouched) scheduler.request();
    });
  }

  const enable = (disableOptions: DisableOptions = {}): void => {
    assertActive();
    scheduler.batch(() => {
      if (!disableOptions.onlySelf) enableChildren();
      setDisabled(false);
    });
  };

  const disable = (disableOptions: DisableOptions = {}): void => {
    assertActive();
    scheduler.batch(() => {
      if (!disableOptions.onlySelf) disableChildren();
      setDisabled(true);
    });
  };

  if (options.disabled) disableChildren();

  return {
    kind: "form",
    state,
    fields: children,

    value,
    completeValue,
    issues,
    validationError,
    status,
    valid,
    invalid,
    pending,
    dirty,
    touched,
    disabled,

    set,
    patch,
    reset,

    touch(): void {
      assertActive();
      scheduler.batch(() => {
        const wasTouched = selfTouched;
        selfTouched = true;
        childNodes.forEach(child => child.touch());
        if (!wasTouched) scheduler.request();
      });
    },

    untouch(): void {
      assertActive();
      scheduler.batch(() => {
        const wasTouched = selfTouched;
        selfTouched = false;
        childNodes.forEach(child => child.untouch());
        if (wasTouched) scheduler.request();
      });
    },

    enable,
    disable,

    useChecks(
      validationSource: object,
      nextChecks?: Check<FormCompleteValue<T>> | readonly Check<FormCompleteValue<T>>[],
    ): void {
      assertActive();
      checkSources.set(validationSource, nextChecks);
      refreshNow();
    },

    clearChecks(validationSource: object): void {
      assertActive();
      if (!checkSources.delete(validationSource)) return;
      refreshNow();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;

      subscriptions.forEach(unsubscribe => {
        try {
          unsubscribe();
        } catch {}
      });

      childNodes.forEach(child => releaseChild(child, container));
      state.dispose();

      if (ownsChildren) {
        childNodes.forEach(child => child.dispose());
      } else {
        enableChildren();
      }
    },
  };
  } catch (error) {
    subscriptions.forEach(unsubscribe => {
      try {
        void unsubscribe();
      } catch {}
    });
    try {
      restoreChildren?.();
    } catch {}
    try {
      disposeState?.();
    } catch {}
    childNodes.forEach(child => releaseChild(child, container));
    throw error;
  }
}

/* ── List ─────────────────────────────────────────────── */

/**
 * Index-preserving list value projection.
 *
 * Disabled children are represented by `undefined` instead of being removed.
 */
export type ListValue<N extends FormNode<any, any>> =
  Array<NodeValue<N> | undefined>;

export interface List<N extends FormNode<any, any>>
  extends FormNode<ListValue<N>, Array<NodeCompleteValue<N>>> {
  readonly kind: "list";
  readonly items: readonly N[];

  push(item: N): void;
  insert(index: number, item: N): void;
  removeAt(index: number): void;
  detachAt(index: number): N | undefined;
  clear(): void;
  batch(work: () => void): void;
}

const MUTATORS = new Set<PropertyKey>([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "copyWithin",
  "fill",
]);

export function list<N extends FormNode<any, any>>(
  initial: readonly N[] = [],
  options: GroupOptions = {},
): List<N> {
  const children = [...initial];
  const container = {};
  const ownsChildren = options.ownsChildren ?? true;
  const childSubscriptions = new Map<N, Subscription>();

  let disposed = false;
  let selfTouched = false;
  let disposeState: (() => void) | undefined;
  let restoreChildren: (() => void) | undefined;

  if (new Set(children).size !== children.length) {
    throw new Error("A form node cannot appear in the same list twice.");
  }

  claimChildren(children, container);

  try {
  const assertActive = (): void => {
    if (disposed) {
      throw new Error("Cannot mutate a disposed list.");
    }
  };

  const assertUniqueChild = (child: N): void => {
    if (children.includes(child)) {
      throw new Error("A form node cannot appear in the same list twice.");
    }
  };

  const calculate = (
    disabled: boolean,
  ): NodeState<ListValue<N>, Array<NodeCompleteValue<N>>> =>
    aggregateChildren(
      children,
      disabled,
      currentChildren => {
        const value: ListValue<N> = [];
        const completeValue: Array<NodeCompleteValue<N>> = [];

        currentChildren.forEach(child => {
          completeValue.push(child.completeValue.value);

          value.push(
            child.disabled.value
              ? undefined
              : child.value.value,
          );
        });

        return {
          value: disabled ? [] : value,
          completeValue,
        };
      },
      null,
      null,
      selfTouched,
    );

  const state = atom(calculate(options.disabled ?? false));
  disposeState = () => state.dispose();

  const refreshNow = (disabled = state.value.disabled): void => {
    if (disposed) return;

    const current = state.value;
    const calculated = calculate(disabled);
    const next: NodeState<ListValue<N>, Array<NodeCompleteValue<N>>> = {
      ...calculated,
      value: reuseArray(current.value, calculated.value),
      completeValue: reuseArray(
        current.completeValue,
        calculated.completeValue,
      ),
      issues: reuseNullableRecord(
        current.issues,
        calculated.issues,
      ),
      validationError: reuseNullableRecord(
        current.validationError as Record<string, unknown> | null,
        calculated.validationError as Record<string, unknown> | null,
      ),
    };

    if (
      shallowEqualState(
        current as unknown as Record<string, unknown>,
        next as unknown as Record<string, unknown>,
      )
    ) {
      return;
    }

    state.set(next);
  };

  const scheduler = createRefreshScheduler(() => refreshNow());
  const disabledByParent = new Set<N>();

  const disableChildIfNeeded = (child: N): void => {
    if (!child.disabled.value) {
      disabledByParent.add(child);
      child.disable();
    }
  };

  const disableChildren = (): void => {
    children.forEach(disableChildIfNeeded);
  };

  const enableChildIfNeeded = (child: N): void => {
    if (disabledByParent.delete(child) && child.disabled.value) {
      child.enable();
    }
  };

  const enableChildren = (): void => {
    [...disabledByParent].forEach(enableChildIfNeeded);
  };
  restoreChildren = enableChildren;

  const observe = (child: N): void => {
    childSubscriptions.set(
      child,
      child.state.subscribe(() => scheduler.request()),
    );
  };

  const unobserve = (child: N): void => {
    const subscription = childSubscriptions.get(child);
    childSubscriptions.delete(child);

    try {
      subscription?.();
    } catch {}
  };

  children.forEach(observe);

  const setDisabled = (disabled: boolean): void => {
    assertActive();
    if (state.value.disabled === disabled) return;
    refreshNow(disabled);
  };

  const {
    value,
    completeValue,
    issues,
    validationError,
    status,
    valid,
    invalid,
    pending,
    dirty,
    touched,
  } = createStateProjections(state, [
    "value",
    "completeValue",
    "issues",
    "validationError",
    "status",
    "valid",
    "invalid",
    "pending",
    "dirty",
    "touched",
  ]);
  const disabled = createWritableView(
    state,
    current => current.disabled,
    next => {
      if (next) disable();
      else enable();
    },
  );

  const items = new Proxy(children as readonly N[], {
    get(target, property, receiver) {
      if (MUTATORS.has(property)) {
        return () => {
          throw new TypeError(
            "List items are read-only; use list mutation methods.",
          );
        };
      }

      return Reflect.get(target, property, receiver);
    },

    set() {
      throw new TypeError(
        "List items are read-only; use list mutation methods.",
      );
    },

    deleteProperty() {
      throw new TypeError(
        "List items are read-only; use list mutation methods.",
      );
    },

    defineProperty() {
      throw new TypeError(
        "List items are read-only; use list mutation methods.",
      );
    },
  });

  const set = (
    next: Array<NodeCompleteValue<N>>,
    writeOptions: WriteOptions = {},
  ): void => {
    assertActive();
    if (next.length !== children.length) {
      throw new RangeError(
        `Expected ${children.length} values, received ${next.length}.`,
      );
    }

    scheduler.batch(() => {
      children.forEach((child, index) => {
        child.set(next[index], writeOptions);
      });
    });
  };

  const push = (child: N): void => {
    assertActive();
    assertUniqueChild(child);
    claimChildren([child], container);

    try {
      scheduler.batch(() => {
        children.push(child);
        observe(child);
        if (state.value.disabled) disableChildIfNeeded(child);
        scheduler.request();
      });
    } catch (error) {
      try {
        const index = children.indexOf(child);
        if (index >= 0) children.splice(index, 1);
        unobserve(child);
        enableChildIfNeeded(child);
        releaseChild(child, container);
        scheduler.request();
      } finally {
        throw error;
      }
    }
  };

  const insert = (index: number, child: N): void => {
    assertActive();
    assertUniqueChild(child);
    claimChildren([child], container);

    try {
      scheduler.batch(() => {
        children.splice(
          Math.max(0, Math.min(index, children.length)),
          0,
          child,
        );

        observe(child);
        if (state.value.disabled) disableChildIfNeeded(child);
        scheduler.request();
      });
    } catch (error) {
      try {
        const childIndex = children.indexOf(child);
        if (childIndex >= 0) children.splice(childIndex, 1);
        unobserve(child);
        enableChildIfNeeded(child);
        releaseChild(child, container);
        scheduler.request();
      } finally {
        throw error;
      }
    }
  };

  const detachAt = (index: number): N | undefined => {
    assertActive();
    if (index < 0 || index >= children.length) return undefined;

    let child!: N;

    scheduler.batch(() => {
      [child] = children.splice(index, 1);
      unobserve(child);
      releaseChild(child, container);
      enableChildIfNeeded(child);
      scheduler.request();
    });

    return child;
  };

  const removeAt = (index: number): void => {
    const child = detachAt(index);

    if (child && ownsChildren) {
      child.dispose();
    }
  };

  const clear = (): void => {
    assertActive();
    scheduler.batch(() => {
      const removed = children.splice(0, children.length);

      removed.forEach(child => {
        unobserve(child);
        releaseChild(child, container);

        if (ownsChildren) {
          disabledByParent.delete(child);
          child.dispose();
        } else {
          enableChildIfNeeded(child);
        }
      });

      scheduler.request();
    });
  };

  const batch = (work: () => void): void => {
    assertActive();
    scheduler.batch(work);
  };

  function reset(): void;
  function reset(
    next: Array<NodeCompleteValue<N>>,
    resetOptions?: ResetOptions,
  ): void;
  function reset(
    next?: Array<NodeCompleteValue<N>>,
    resetOptions: ResetOptions = {},
  ): void {
    assertActive();
    const supplied = arguments.length > 0;

    if (supplied && next!.length !== children.length) {
      throw new RangeError(
        `Expected ${children.length} values, received ${next!.length}.`,
      );
    }

    scheduler.batch(() => {
      const wasTouched = selfTouched;
      selfTouched = false;

      children.forEach((child, index) => {
        if (supplied) {
          child.reset(next![index], resetOptions);
        } else {
          child.reset();
        }
      });

      if (wasTouched) scheduler.request();
    });
  }

  const enable = (disableOptions: DisableOptions = {}): void => {
    assertActive();
    scheduler.batch(() => {
      if (!disableOptions.onlySelf) enableChildren();
      setDisabled(false);
    });
  };

  const disable = (disableOptions: DisableOptions = {}): void => {
    assertActive();
    scheduler.batch(() => {
      if (!disableOptions.onlySelf) disableChildren();
      setDisabled(true);
    });
  };

  if (options.disabled) disableChildren();

  return {
    kind: "list",
    state,

    value,
    completeValue,
    issues,
    validationError,
    status,
    valid,
    invalid,
    pending,
    dirty,
    touched,
    disabled,

    items,
    set,
    push,
    insert,
    removeAt,
    detachAt,
    clear,
    batch,
    reset,

    touch(): void {
      assertActive();
      scheduler.batch(() => {
        const wasTouched = selfTouched;
        selfTouched = true;
        children.forEach(child => child.touch());
        if (!wasTouched) scheduler.request();
      });
    },

    untouch(): void {
      assertActive();
      scheduler.batch(() => {
        const wasTouched = selfTouched;
        selfTouched = false;
        children.forEach(child => child.untouch());
        if (wasTouched) scheduler.request();
      });
    },

    enable,
    disable,

    dispose(): void {
      if (disposed) return;
      disposed = true;

      children.forEach(unobserve);
      children.forEach(child => releaseChild(child, container));
      state.dispose();

      if (ownsChildren) {
        children.forEach(child => child.dispose());
      } else {
        enableChildren();
      }

      children.length = 0;
    },
  };
  } catch (error) {
    childSubscriptions.forEach(subscription => {
      try {
        void subscription();
      } catch {}
    });
    childSubscriptions.clear();
    try {
      restoreChildren?.();
    } catch {}
    try {
      disposeState?.();
    } catch {}
    children.forEach(child => releaseChild(child, container));
    throw error;
  }
}

/* ── Helpers ──────────────────────────────────────────── */

export function watchNode(
  node: FormNode<any, any>,
  callback: () => void,
): () => void {
  const subscription = node.state.subscribe(callback);

  return () => {
    try {
      subscription();
    } catch {}
  };
}

export function formSnapshot<N extends FormNode<any, any>>(
  node: N,
): NodeCompleteValue<N> {
  return node.completeValue.value as NodeCompleteValue<N>;
}

export function syncList<N extends FormNode<any, any>>(
  listNode: List<N>,
  next: readonly NodeCompleteValue<N>[],
  create: (value: NodeCompleteValue<N>) => N,
): void {
  listNode.batch(() => {
    while (listNode.items.length > next.length) {
      listNode.removeAt(listNode.items.length - 1);
    }

    while (listNode.items.length < next.length) {
      listNode.push(create(next[listNode.items.length]));
    }

    listNode.items.forEach((child, index) => {
      child.reset(next[index], { updateInitial: true });
    });
  });
}

/**
 * Resolves when the delay finishes or the signal is aborted.
 * Aborting is treated as cancellation, not as an error.
 */
export function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise(resolve => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };

    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
  });
}

/* ── Checks ───────────────────────────────────────────── */

export interface Checks {
  required<T>(value: T): ValidationIssues | null;
  requiredTrue(value: unknown): ValidationIssues | null;
  minLength(minimum: number): Check<unknown>;
  maxLength(maximum: number): Check<unknown>;
  number(value: unknown): ValidationIssues | null;
  min(minimum: number): Check<unknown>;
  max(maximum: number): Check<unknown>;
  pattern(pattern: string | RegExp): Check<unknown>;
  email(value: unknown): ValidationIssues | null;
  compose<T>(...items: readonly Check<T>[]): Check<T>;
  composeAsync<T>(...items: readonly AsyncCheck<T>[]): AsyncCheck<T>;
}

export const checks: Checks = Object.freeze({
  required<T>(value: T): ValidationIssues | null {
    return isEmpty(value) ? { required: true } : null;
  },

  requiredTrue(value: unknown): ValidationIssues | null {
    return value === true ? null : { required: true };
  },

  minLength(minimum: number): Check<unknown> {
    return value => {
      if (isEmpty(value)) return null;

      const length = (value as { length?: unknown }).length;

      return typeof length === "number" && length < minimum
        ? { minLength: { required: minimum, actual: length } }
        : null;
    };
  },

  maxLength(maximum: number): Check<unknown> {
    return value => {
      if (isEmpty(value)) return null;

      const length = (value as { length?: unknown }).length;

      return typeof length === "number" && length > maximum
        ? { maxLength: { required: maximum, actual: length } }
        : null;
    };
  },

  number(value: unknown): ValidationIssues | null {
    if (isEmpty(value)) return null;

    if (typeof value === "number") {
      return Number.isFinite(value) ? null : { number: true };
    }

    if (typeof value !== "string" || value.trim() === "") {
      return { number: true };
    }

    return Number.isFinite(Number(value)) ? null : { number: true };
  },

  min(minimum: number): Check<unknown> {
    return value => {
      if (isEmpty(value)) return null;

      const numeric = typeof value === "number" ? value : Number(value);

      if (!Number.isFinite(numeric)) return { number: true };

      return numeric < minimum
        ? { min: { required: minimum, actual: numeric } }
        : null;
    };
  },

  max(maximum: number): Check<unknown> {
    return value => {
      if (isEmpty(value)) return null;

      const numeric = typeof value === "number" ? value : Number(value);

      if (!Number.isFinite(numeric)) return { number: true };

      return numeric > maximum
        ? { max: { required: maximum, actual: numeric } }
        : null;
    };
  },

  pattern(pattern: string | RegExp): Check<unknown> {
    const expression =
      typeof pattern === "string"
        ? new RegExp(`^(?:${pattern})$`)
        : new RegExp(
            pattern.source,
            pattern.flags.replace(/[gy]/g, ""),
          );

    return value =>
      isEmpty(value)
        ? null
        : expression.test(String(value))
          ? null
          : {
              pattern: {
                required: pattern.toString(),
                actual: value,
              },
            };
  },

  email(value: unknown): ValidationIssues | null {
    return isEmpty(value)
      ? null
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
        ? null
        : { email: true };
  },

  compose<T>(...items: readonly Check<T>[]): Check<T> {
    return value => mergeIssues(...items.map(check => check(value)));
  },

  composeAsync<T>(
    ...items: readonly AsyncCheck<T>[]
  ): AsyncCheck<T> {
    return async (value, signal) => {
      const results = await Promise.all(
        items.map(check => Promise.resolve(check(value, signal))),
      );

      return mergeIssues(...results);
    };
  },
});

/* ── Field feedback helpers ───────────────────────────── */

export type FieldInputType =
  | "text"
  | "email"
  | "password"
  | "date"
  | "textarea"
  | "number"
  | "range";

export interface FieldView<T = unknown> {
  readonly node: Field<T>;
  readonly label: string;
  readonly type?: FieldInputType;
  readonly rows?: number;
  readonly min?: number;
  readonly max?: number;
  readonly compact?: boolean;
  readonly pendingHint?: string;
  readonly hint?: (value: T) => string | null;
}

export const defaultFieldMessages:
  Readonly<Record<string, string>> = Object.freeze({
    required: "This field is required.",
    email: "Use a valid email address.",
    pattern: "Format is invalid.",
    passwordMismatch: "Passwords must match.",
    usernameTaken: "Username is already taken.",
  });

const RANGE_KEYS = new Set([
  "minLength",
  "maxLength",
  "min",
  "max",
]);

export function formatFieldError(
  node: Field<any>,
  messages: Readonly<Record<string, string>> = defaultFieldMessages,
  pendingHint?: string,
): string | null {
  if (
    (pendingHint && node.pending.value) ||
    (!node.dirty.value && !node.touched.value)
  ) {
    return null;
  }

  if (node.validationError.value !== null) {
    return "Validation failed.";
  }

  const issues = node.issues.value;
  if (!issues) return null;

  const [name, payload] = Object.entries(issues)[0] ?? [];
  if (!name) return null;

  if (messages[name]) return messages[name];

  if (RANGE_KEYS.has(name)) {
    const required =
      typeof payload === "object" &&
      payload !== null &&
      "required" in payload
        ? String((payload as { required: unknown }).required)
        : "";

    const limit = name.startsWith("max")
      ? "Maximum"
      : "Minimum";

    const subject =
      name === "minLength" || name === "maxLength"
        ? "length"
        : "value";

    return `${limit} ${subject} is ${required}.`;
  }

  return "Value is invalid.";
}

export function fieldHint(
  fieldView: FieldView<any>,
): string | null {
  if (
    fieldView.pendingHint &&
    fieldView.node.pending.value
  ) {
    return fieldView.pendingHint;
  }

  return fieldView.hint?.(
    fieldView.node.completeValue.value,
  ) ?? null;
}

export function fieldError(
  fieldView: FieldView<any>,
  messages: Readonly<Record<string, string>> = defaultFieldMessages,
): string | null {
  return formatFieldError(
    fieldView.node,
    messages,
    fieldView.pendingHint,
  );
}
