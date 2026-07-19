// forms.ts — functional, atom-native forms for Streamix

import type { Subscription } from "@epikodelabs/streamix";
import { atom, derived, type Atom, type Writable } from "@epikodelabs/streamix";

/* ── Public model ─────────────────────────────────────── */

export type ValidationIssues = Readonly<Record<string, unknown>>;
export type MaybePromise<T> = T | PromiseLike<T>;

export type Check<T> = (value: T) => ValidationIssues | null;
export type AsyncCheck<T> = (
  value: T,
  signal: AbortSignal,
) => MaybePromise<ValidationIssues | null>;

export type FormStatus =
  | "valid"
  | "invalid"
  | "pending"
  | "disabled"
  | "error";

export interface ResetOptions {
  /** Make the supplied value the new pristine baseline. */
  updateInitial?: boolean;
}

export interface WriteOptions {
  /** Touch the node after writing. */
  touch?: boolean;
}

export interface GroupOptions {
  /** Groups own and dispose their children by default. */
  ownsChildren?: boolean;
  disabled?: boolean;
}

const FORM_REVISION = Symbol("streamix.formRevision");

const ARRAY_MUTATORS = new Set<PropertyKey>([
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

type InternalNode = {
  readonly [FORM_REVISION]: Atom<number>;
};

export interface FormNode<Value, CompleteValue = Value> {
  readonly kind: "field" | "form" | "list";

  /** Current value, excluding disabled descendants in groups. */
  readonly value: Atom<Value>;

  /** Complete value, including disabled descendants. */
  readonly completeValue: Atom<CompleteValue>;

  /** Validation-rule failures. */
  readonly issues: Atom<ValidationIssues | null>;

  /** Failure of the validation process itself, such as a network error. */
  readonly validationError: Atom<unknown | null>;

  readonly status: Atom<FormStatus>;
  readonly valid: Atom<boolean>;
  readonly invalid: Atom<boolean>;
  readonly pending: Atom<boolean>;
  readonly dirty: Atom<boolean>;
  readonly touched: Atom<boolean>;
  readonly disabled: Writable<boolean>;

  set(value: CompleteValue, options?: WriteOptions): void;
  reset(): void;
  reset(value: CompleteValue, options?: ResetOptions): void;

  touch(): void;
  untouch(): void;
  enable(): void;
  disable(): void;
  dispose(): void;
}

export type NodeValue<N> = N extends FormNode<infer V, any> ? V : never;
export type NodeCompleteValue<N> = N extends FormNode<any, infer V> ? V : never;
export type NodeMap = Record<string, FormNode<any, any>>;

export type FormCompleteValue<T extends NodeMap> = {
  [K in keyof T]: NodeCompleteValue<T[K]>;
};

/** Disabled children are omitted. */
export type FormValue<T extends NodeMap> = Partial<{
  [K in keyof T]: NodeValue<T[K]>;
}>;

export interface FieldOptions<T> {
  checks?: Check<T> | readonly Check<T>[];
  asyncChecks?: AsyncCheck<T> | readonly AsyncCheck<T>[];
  disabled?: boolean;

  /** Skip async checks while synchronous checks report issues. Default: true. */
  asyncOnlyWhenSyncClean?: boolean;

  /** Optional delay before async checks begin. Default: 0. */
  asyncDelay?: number;

  /** Optionally map rejected async checks to validation issues. */
  asyncFailureToIssues?: (error: unknown) => ValidationIssues | null;
}

/* ── Internal helpers ─────────────────────────────────── */

function normalize<T>(value?: T | readonly T[]): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? [...value] : [value as T];
}

function mergeIssues(
  ...sources: readonly (ValidationIssues | null | undefined)[]
): ValidationIssues | null {
  let merged: Record<string, unknown> | undefined;

  for (const source of sources) {
    if (!source) continue;
    merged ??= {};
    Object.assign(merged, source);
  }

  return merged ? Object.freeze(merged) : null;
}

function isEmpty(value: unknown): boolean {
  return value == null
    || value === ""
    || (Array.isArray(value) && value.length === 0);
}

function teardown(subscription: Subscription | (() => void) | undefined): void {
  if (!subscription) return;

  try {
    subscription();
  } catch {
    // Disposal is idempotent and best-effort.
  }
}

function disposeAtom(value: { dispose(): void } | undefined): void {
  try {
    value?.dispose();
  } catch {
    // Aggregate disposal should not fail because one child already stopped.
  }
}

function setIfChanged<T>(target: Writable<T>, next: T): boolean {
  if (Object.is(target.value, next)) return false;
  target.set(next);
  return true;
}

function shallowRecordEqual(
  left: Readonly<Record<PropertyKey, unknown>>,
  right: Readonly<Record<PropertyKey, unknown>>,
): boolean {
  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.is(left[key], right[key]));
}

function shallowArrayEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length
    && left.every((value, index) => Object.is(value, right[index]));
}

function setRecordIfChanged<T extends Record<PropertyKey, unknown>>(
  target: Writable<T>,
  next: T,
): boolean {
  if (shallowRecordEqual(target.value, next)) return false;
  target.set(next);
  return true;
}

function setArrayIfChanged<T>(target: Writable<readonly T[]>, next: readonly T[]): boolean {
  if (shallowArrayEqual(target.value, next)) return false;
  target.set(next);
  return true;
}

function setNullableRecordIfChanged(
  target: Writable<ValidationIssues | null>,
  next: ValidationIssues | null,
): boolean {
  const current = target.value;

  if (current === next) return false;
  if (current === null || next === null) {
    target.set(next);
    return true;
  }

  if (shallowRecordEqual(current, next)) return false;
  target.set(next);
  return true;
}

interface AggregateState {
  readonly issues: Writable<ValidationIssues | null>;
  readonly validationError: Writable<unknown | null>;
  readonly status: Writable<FormStatus>;
  readonly valid: Writable<boolean>;
  readonly invalid: Writable<boolean>;
  readonly pending: Writable<boolean>;
  readonly dirty: Writable<boolean>;
  readonly touched: Writable<boolean>;
  readonly revision: Writable<number>;
}

function syncAggregateFlags(
  state: AggregateState,
  disabled: boolean,
  issues: ValidationIssues | null,
  validationError: unknown | null,
  pending: boolean,
  dirty: boolean,
  touched: boolean,
  valueChanged: boolean,
): void {
  const status = statusOf(disabled, pending, issues, validationError);

  // Never use `changed ||= update()` here: once `changed` becomes true,
  // logical assignment would skip every later update.
  let changed = valueChanged;
  changed = setNullableRecordIfChanged(state.issues, issues) || changed;
  changed = setIfChanged(state.validationError, validationError) || changed;
  changed = setIfChanged(state.pending, pending) || changed;
  changed = setIfChanged(state.dirty, dirty) || changed;
  changed = setIfChanged(state.touched, touched) || changed;
  changed = setIfChanged(state.status, status) || changed;
  changed = setIfChanged(state.valid, status === "valid" || status === "disabled") || changed;
  changed = setIfChanged(state.invalid, status === "invalid") || changed;

  if (changed) bump(state.revision);
}

function statusOf(
  disabled: boolean,
  pending: boolean,
  issues: ValidationIssues | null,
  validationError: unknown | null,
): FormStatus {
  if (disabled) return "disabled";
  if (pending) return "pending";
  if (validationError !== null) return "error";
  if (issues !== null) return "invalid";
  return "valid";
}

function bump(revision: Writable<number>): void {
  revision.set(revision.value + 1);
}

function subscribeToNode(node: FormNode<any, any>, callback: () => void): () => void {
  const internal = node as FormNode<any, any> & InternalNode;
  const subscription = internal[FORM_REVISION].subscribe(callback);
  return () => teardown(subscription);
}

/** Subscribe once to any public state change produced by a form node. */
export function watchNode(
  node: FormNode<any, any>,
  callback: () => void,
): () => void {
  return subscribeToNode(node, callback);
}

function attachRevision(
  revision: Writable<number>,
  sources: readonly Atom<unknown>[],
): () => void {
  const subscriptions = sources.map(source => source.subscribe(() => bump(revision)));
  return () => subscriptions.forEach(teardown);
}

/* ── Field ────────────────────────────────────────────── */

export interface Field<T> extends FormNode<T> {
  readonly kind: "field";
  readonly value: Writable<T>;
  readonly completeValue: Writable<T>;
  readonly initialValue: Atom<T>;
  readonly syncIssues: Atom<ValidationIssues | null>;
  readonly asyncIssues: Atom<ValidationIssues | null>;
}

export function field<T>(initial: T, options: FieldOptions<T> = {}): Field<T> {
  const value = atom<T>(initial);
  const completeValue = value;
  const initialValue = atom<T>(initial);
  const touched = atom(false);
  const disabled = atom(options.disabled ?? false);

  const syncChecks = normalize(options.checks);
  const asyncChecks = normalize(options.asyncChecks);
  const asyncOnlyWhenSyncClean = options.asyncOnlyWhenSyncClean ?? true;
  const asyncDelay = Math.max(0, options.asyncDelay ?? 0);

  const dirty = derived<boolean>($ => !Object.is($(value), $(initialValue)));

  const syncIssues = derived<ValidationIssues | null>($ => {
    if ($(disabled)) return null;
    const current = $(value);
    return mergeIssues(...syncChecks.map(check => check(current)));
  });

  const asyncIssues = atom<ValidationIssues | null>(null);
  const validationError = atom<unknown | null>(null);
  const pending = atom(false);

  let disposed = false;
  let runId = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued = false;

  const cancelAsync = (): void => {
    runId++;
    controller?.abort();
    controller = undefined;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    setIfChanged(pending, false);
  };

  const executeAsync = async (): Promise<void> => {
    if (disposed) return;

    cancelAsync();
    setIfChanged(validationError, null);

    if (
      disabled.value
      || asyncChecks.length === 0
      || (asyncOnlyWhenSyncClean && syncIssues.value !== null)
    ) {
      setIfChanged(asyncIssues, null);
      return;
    }

    const currentRun = runId;
    const currentController = new AbortController();
    controller = currentController;
    setIfChanged(pending, true);

    try {
      const results = await Promise.all(
        asyncChecks.map(check =>
          Promise.resolve(check(value.value, currentController.signal)),
        ),
      );

      if (disposed || currentController.signal.aborted || currentRun !== runId) return;
      setIfChanged(asyncIssues, mergeIssues(...results));
    } catch (error) {
      if (disposed || currentController.signal.aborted || currentRun !== runId) return;

      setIfChanged(validationError, error);
      setIfChanged(asyncIssues, options.asyncFailureToIssues?.(error) ?? null);
    } finally {
      if (!disposed && currentRun === runId) {
        controller = undefined;
        setIfChanged(pending, false);
      }
    }
  };

  const scheduleAsync = (): void => {
    if (disposed || queued) return;
    queued = true;

    queueMicrotask(() => {
      queued = false;
      if (disposed) return;

      if (asyncDelay === 0) {
        void executeAsync();
        return;
      }

      cancelAsync();
      timer = setTimeout(() => {
        timer = undefined;
        void executeAsync();
      }, asyncDelay);
    });
  };

  const valueSub = value.subscribe(scheduleAsync);
  const disabledSub = disabled.subscribe(scheduleAsync);
  const syncIssuesSub = syncIssues.subscribe(scheduleAsync);
  scheduleAsync();

  const issues = derived<ValidationIssues | null>($ => {
    if ($(disabled)) return null;
    return mergeIssues($(syncIssues), $(asyncIssues));
  });

  const status = derived<FormStatus>($ =>
    statusOf($(disabled), $(pending), $(issues), $(validationError)),
  );
  const valid = derived<boolean>($ => $(status) === "valid" || $(status) === "disabled");
  const invalid = derived<boolean>($ => $(status) === "invalid");

  const revision = atom(0);
  const stopRevision = attachRevision(revision, [
    value,
    issues,
    validationError,
    status,
    dirty,
    touched,
  ]);

  const set = (next: T, writeOptions: WriteOptions = {}): void => {
    value.set(next);
    if (writeOptions.touch) touched.set(true);
  };

  function reset(): void;
  function reset(next: T, resetOptions?: ResetOptions): void;
  function reset(next?: T, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;
    const target = supplied ? next as T : initialValue.value;

    if (supplied && resetOptions.updateInitial) initialValue.set(target);
    value.set(target);
    touched.set(false);
  }

  const touch = (): void => touched.set(true);
  const untouch = (): void => touched.set(false);
  const enable = (): void => disabled.set(false);
  const disable = (): void => disabled.set(true);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAsync();

    teardown(valueSub);
    teardown(disabledSub);
    teardown(syncIssuesSub);
    stopRevision();

    disposeAtom(revision);
    disposeAtom(value);
    disposeAtom(initialValue);
    disposeAtom(touched);
    disposeAtom(disabled);
    disposeAtom(syncIssues);
    disposeAtom(asyncIssues);
    disposeAtom(validationError);
    disposeAtom(pending);
    disposeAtom(dirty);
    disposeAtom(issues);
    disposeAtom(status);
    disposeAtom(valid);
    disposeAtom(invalid);
  };

  return {
    kind: "field",
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
    set,
    reset,
    touch,
    untouch,
    enable,
    disable,
    dispose,
    [FORM_REVISION]: revision,
  } as Field<T> & InternalNode;
}

/* ── Form ─────────────────────────────────────────────── */

export interface Form<T extends NodeMap>
  extends FormNode<FormValue<T>, FormCompleteValue<T>> {
  readonly kind: "form";
  readonly value: Atom<FormValue<T>>;
  readonly completeValue: Atom<FormCompleteValue<T>>;
  readonly fields: Readonly<T>;

  set(value: FormCompleteValue<T>, options?: WriteOptions): void;
  patch(value: Partial<FormCompleteValue<T>>, options?: WriteOptions): void;
}

export function form<T extends NodeMap>(
  fields: T,
  options: GroupOptions = {},
): Form<T> {
  const ownsChildren = options.ownsChildren ?? true;
  const children = Object.freeze({ ...fields }) as Readonly<T>;
  const disabled = atom(options.disabled ?? false);

  const valueState = atom<FormValue<T>>({});
  const completeValueState = atom<FormCompleteValue<T>>({} as FormCompleteValue<T>);
  const issuesState = atom<ValidationIssues | null>(null);
  const validationErrorState = atom<unknown | null>(null);
  const statusState = atom<FormStatus>(disabled.value ? "disabled" : "valid");
  const validState = atom(disabled.value);
  const invalidState = atom(false);
  const pendingState = atom(false);
  const dirtyState = atom(false);
  const touchedState = atom(false);
  const revision = atom(0);

  let disposed = false;
  let queued = false;

  const recompute = (): void => {
    queued = false;
    if (disposed) return;

    const enabled: Record<string, unknown> = {};
    const complete: Record<string, unknown> = {};
    const issuesByField: Record<string, unknown> = {};
    const errorsByField: Record<string, unknown> = {};

    let anyPending = false;
    let anyDirty = false;
    let anyTouched = false;

    for (const [key, child] of Object.entries(children)) {
      complete[key] = child.completeValue.value;
      anyDirty ||= child.dirty.value;
      anyTouched ||= child.touched.value;

      if (child.disabled.value) continue;

      enabled[key] = child.value.value;
      anyPending ||= child.pending.value;
      if (child.issues.value) issuesByField[key] = child.issues.value;
      if (child.validationError.value !== null) {
        errorsByField[key] = child.validationError.value;
      }
    }

    const groupDisabled = disabled.value;
    const aggregateIssues = groupDisabled || Object.keys(issuesByField).length === 0
      ? null
      : Object.freeze(issuesByField);
    const aggregateValidationError = groupDisabled || Object.keys(errorsByField).length === 0
      ? null
      : Object.freeze(errorsByField);
    const aggregatePending = !groupDisabled && anyPending;
    let valueChanged = false;
    valueChanged = setRecordIfChanged(
      valueState as Writable<Record<string, unknown>>,
      groupDisabled ? {} : enabled,
    ) || valueChanged;
    valueChanged = setRecordIfChanged(
      completeValueState as Writable<Record<string, unknown>>,
      complete,
    ) || valueChanged;

    syncAggregateFlags(
      {
        issues: issuesState,
        validationError: validationErrorState,
        status: statusState,
        valid: validState,
        invalid: invalidState,
        pending: pendingState,
        dirty: dirtyState,
        touched: touchedState,
        revision,
      },
      groupDisabled,
      aggregateIssues,
      aggregateValidationError,
      aggregatePending,
      anyDirty,
      anyTouched,
      valueChanged,
    );
  };

  const queueRecompute = (): void => {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(recompute);
  };

  const childTeardowns = Object.values(children).map(child =>
    subscribeToNode(child, queueRecompute),
  );
  const disabledSub = disabled.subscribe(queueRecompute);
  recompute();

  const set = (next: FormCompleteValue<T>, writeOptions: WriteOptions = {}): void => {
    for (const key of Object.keys(children) as Array<keyof T>) {
      children[key].set(next[key], writeOptions);
    }
  };

  const patch = (
    next: Partial<FormCompleteValue<T>>,
    writeOptions: WriteOptions = {},
  ): void => {
    for (const key of Object.keys(next) as Array<keyof T>) {
      if (key in children) children[key].set(next[key]!, writeOptions);
    }
  };

  function reset(): void;
  function reset(next: FormCompleteValue<T>, resetOptions?: ResetOptions): void;
  function reset(next?: FormCompleteValue<T>, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;

    for (const key of Object.keys(children) as Array<keyof T>) {
      if (supplied) children[key].reset(next![key], resetOptions);
      else children[key].reset();
    }
  }

  const touch = (): void => Object.values(children).forEach(child => child.touch());
  const untouch = (): void => Object.values(children).forEach(child => child.untouch());
  const enable = (): void => disabled.set(false);
  const disable = (): void => disabled.set(true);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    teardown(disabledSub);
    childTeardowns.forEach(stop => stop());
    if (ownsChildren) Object.values(children).forEach(child => child.dispose());

    disposeAtom(valueState);
    disposeAtom(completeValueState);
    disposeAtom(issuesState);
    disposeAtom(validationErrorState);
    disposeAtom(statusState);
    disposeAtom(validState);
    disposeAtom(invalidState);
    disposeAtom(pendingState);
    disposeAtom(dirtyState);
    disposeAtom(touchedState);
    disposeAtom(disabled);
    disposeAtom(revision);
  };

  return {
    kind: "form",
    value: valueState,
    completeValue: completeValueState,
    issues: issuesState,
    validationError: validationErrorState,
    status: statusState,
    valid: validState,
    invalid: invalidState,
    pending: pendingState,
    dirty: dirtyState,
    touched: touchedState,
    disabled,
    fields: children,
    set,
    patch,
    reset,
    touch,
    untouch,
    enable,
    disable,
    dispose,
    [FORM_REVISION]: revision,
  } as Form<T> & InternalNode;
}

/* ── List ─────────────────────────────────────────────── */

export interface List<N extends FormNode<any, any>>
  extends FormNode<Array<NodeValue<N>>, Array<NodeCompleteValue<N>>> {
  readonly kind: "list";
  readonly value: Atom<Array<NodeValue<N>>>;
  readonly completeValue: Atom<Array<NodeCompleteValue<N>>>;
  readonly items: readonly N[];

  set(value: Array<NodeCompleteValue<N>>, options?: WriteOptions): void;
  push(item: N): void;
  insert(index: number, item: N): void;
  removeAt(index: number): void;
  detachAt(index: number): N | undefined;
  clear(): void;
}

export function list<N extends FormNode<any, any>>(
  initial: readonly N[] = [],
  options: GroupOptions = {},
): List<N> {
  const ownsChildren = options.ownsChildren ?? true;
  const children: N[] = [...initial];
  const disabled = atom(options.disabled ?? false);

  const valueState = atom<Array<NodeValue<N>>>([]);
  const completeValueState = atom<Array<NodeCompleteValue<N>>>([]);
  const issuesState = atom<ValidationIssues | null>(null);
  const validationErrorState = atom<unknown | null>(null);
  const statusState = atom<FormStatus>(disabled.value ? "disabled" : "valid");
  const validState = atom(disabled.value);
  const invalidState = atom(false);
  const pendingState = atom(false);
  const dirtyState = atom(false);
  const touchedState = atom(false);
  const revision = atom(0);

  const subscriptions = new Map<N, () => void>();
  let disposed = false;
  let queued = false;

  const recompute = (): void => {
    queued = false;
    if (disposed) return;

    const enabled: Array<NodeValue<N>> = [];
    const complete: Array<NodeCompleteValue<N>> = [];
    const issuesByIndex: Record<number, unknown> = {};
    const errorsByIndex: Record<number, unknown> = {};

    let anyPending = false;
    let anyDirty = false;
    let anyTouched = false;

    children.forEach((child, index) => {
      complete.push(child.completeValue.value);
      anyDirty ||= child.dirty.value;
      anyTouched ||= child.touched.value;

      if (child.disabled.value) return;

      enabled.push(child.value.value);
      anyPending ||= child.pending.value;
      if (child.issues.value) issuesByIndex[index] = child.issues.value;
      if (child.validationError.value !== null) {
        errorsByIndex[index] = child.validationError.value;
      }
    });

    const groupDisabled = disabled.value;
    const aggregateIssues = groupDisabled || Object.keys(issuesByIndex).length === 0
      ? null
      : Object.freeze(issuesByIndex);
    const aggregateValidationError = groupDisabled || Object.keys(errorsByIndex).length === 0
      ? null
      : Object.freeze(errorsByIndex);
    const aggregatePending = !groupDisabled && anyPending;
    let valueChanged = false;
    valueChanged = setArrayIfChanged(valueState, groupDisabled ? [] : enabled) || valueChanged;
    valueChanged = setArrayIfChanged(completeValueState, complete) || valueChanged;

    syncAggregateFlags(
      {
        issues: issuesState,
        validationError: validationErrorState,
        status: statusState,
        valid: validState,
        invalid: invalidState,
        pending: pendingState,
        dirty: dirtyState,
        touched: touchedState,
        revision,
      },
      groupDisabled,
      aggregateIssues,
      aggregateValidationError,
      aggregatePending,
      anyDirty,
      anyTouched,
      valueChanged,
    );
  };

  const queueRecompute = (): void => {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(recompute);
  };

  const attach = (child: N): void => {
    if (subscriptions.has(child)) {
      throw new Error("The same form node cannot be attached to a list twice.");
    }
    subscriptions.set(child, subscribeToNode(child, queueRecompute));
  };

  const detach = (child: N): void => {
    subscriptions.get(child)?.();
    subscriptions.delete(child);
  };

  initial.forEach(attach);
  const disabledSub = disabled.subscribe(queueRecompute);
  recompute();

  const items = new Proxy(children as readonly N[], {
    get(target, property, receiver) {
      if (ARRAY_MUTATORS.has(property)) {
        return () => {
          throw new TypeError("List items are read-only; use list mutation methods.");
        };
      }

      return Reflect.get(target, property, receiver);
    },
    set() {
      throw new TypeError("List items are read-only; use list mutation methods.");
    },
    deleteProperty() {
      throw new TypeError("List items are read-only; use list mutation methods.");
    },
    defineProperty() {
      throw new TypeError("List items are read-only; use list mutation methods.");
    },
  });

  const set = (
    next: Array<NodeCompleteValue<N>>,
    writeOptions: WriteOptions = {},
  ): void => {
    if (next.length !== children.length) {
      throw new RangeError(`Expected ${children.length} values, received ${next.length}.`);
    }
    children.forEach((child, index) => child.set(next[index], writeOptions));
  };

  const push = (child: N): void => {
    attach(child);
    children.push(child);
    queueRecompute();
  };

  const insert = (index: number, child: N): void => {
    const normalized = Math.max(0, Math.min(index, children.length));
    attach(child);
    children.splice(normalized, 0, child);
    queueRecompute();
  };

  const detachAt = (index: number): N | undefined => {
    if (index < 0 || index >= children.length) return undefined;
    const [child] = children.splice(index, 1);
    detach(child);
    queueRecompute();
    return child;
  };

  const removeAt = (index: number): void => {
    const child = detachAt(index);
    if (child && ownsChildren) child.dispose();
  };

  const clear = (): void => {
    const removed = children.splice(0, children.length);
    removed.forEach(child => {
      detach(child);
      if (ownsChildren) child.dispose();
    });
    queueRecompute();
  };

  function reset(): void;
  function reset(next: Array<NodeCompleteValue<N>>, resetOptions?: ResetOptions): void;
  function reset(
    next?: Array<NodeCompleteValue<N>>,
    resetOptions: ResetOptions = {},
  ): void {
    const supplied = arguments.length > 0;
    if (supplied && next!.length !== children.length) {
      throw new RangeError(`Expected ${children.length} values, received ${next!.length}.`);
    }

    children.forEach((child, index) => {
      if (supplied) child.reset(next![index], resetOptions);
      else child.reset();
    });
  }

  const touch = (): void => children.forEach(child => child.touch());
  const untouch = (): void => children.forEach(child => child.untouch());
  const enable = (): void => disabled.set(false);
  const disable = (): void => disabled.set(true);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    teardown(disabledSub);
    [...children].forEach(child => {
      detach(child);
      if (ownsChildren) child.dispose();
    });
    children.length = 0;

    disposeAtom(valueState);
    disposeAtom(completeValueState);
    disposeAtom(issuesState);
    disposeAtom(validationErrorState);
    disposeAtom(statusState);
    disposeAtom(validState);
    disposeAtom(invalidState);
    disposeAtom(pendingState);
    disposeAtom(dirtyState);
    disposeAtom(touchedState);
    disposeAtom(disabled);
    disposeAtom(revision);
  };

  return {
    kind: "list",
    value: valueState,
    completeValue: completeValueState,
    issues: issuesState,
    validationError: validationErrorState,
    status: statusState,
    valid: validState,
    invalid: invalidState,
    pending: pendingState,
    dirty: dirtyState,
    touched: touchedState,
    disabled,
    items,
    set,
    push,
    insert,
    removeAt,
    detachAt,
    clear,
    reset,
    touch,
    untouch,
    enable,
    disable,
    dispose,
    [FORM_REVISION]: revision,
  } as List<N> & InternalNode;
}

/* ── Checks ───────────────────────────────────────────── */

export const checks = Object.freeze({
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
    if (typeof value !== "string" || value.trim() === "") return { number: true };
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
    const expression = typeof pattern === "string"
      ? new RegExp(`^(?:${pattern})$`)
      : new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));

    return value => {
      if (isEmpty(value)) return null;
      return expression.test(String(value))
        ? null
        : { pattern: { required: pattern.toString(), actual: value } };
    };
  },

  email(value: unknown): ValidationIssues | null {
    if (isEmpty(value)) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))
      ? null
      : { email: true };
  },

  compose<T>(...items: readonly Check<T>[]): Check<T> {
    return value => mergeIssues(...items.map(check => check(value)));
  },

  composeAsync<T>(...items: readonly AsyncCheck<T>[]): AsyncCheck<T> {
    return async (value, signal) => {
      const results = await Promise.all(
        items.map(check => Promise.resolve(check(value, signal))),
      );
      return mergeIssues(...results);
    };
  },
});
