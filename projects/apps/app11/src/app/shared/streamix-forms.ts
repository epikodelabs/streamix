// streamix-forms.ts — functional, atom-native forms for Streamix

import type { Subscription } from "@epikodelabs/streamix";
import { atom, derived, scope, type Atom, type Writable } from "@epikodelabs/streamix";

/* ── Public model ─────────────────────────────────────── */

export type ValidationIssues = Readonly<Record<string, unknown>>;
export type MaybePromise<T> = T | PromiseLike<T>;
export type Check<T> = (value: T) => ValidationIssues | null;
export type AsyncCheck<T> = (value: T, signal: AbortSignal) => MaybePromise<ValidationIssues | null>;
export type FormStatus = "valid" | "invalid" | "pending" | "disabled" | "error";

export interface ResetOptions { updateInitial?: boolean; }
export interface WriteOptions { touch?: boolean; }
export interface GroupOptions { ownsChildren?: boolean; disabled?: boolean; }

export interface FieldOptions<T> {
  checks?: Check<T> | readonly Check<T>[];
  asyncChecks?: AsyncCheck<T> | readonly AsyncCheck<T>[];
  disabled?: boolean;
  asyncOnlyWhenSyncClean?: boolean;
  asyncDelay?: number;
  asyncFailureToIssues?: (error: unknown) => ValidationIssues | null;
}

const FORM_REVISION = Symbol("streamix.formRevision");
const ARRAY_MUTATORS = new Set<PropertyKey>([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "copyWithin", "fill",
]);

type InternalNode = { readonly [FORM_REVISION]: Atom<number> };

export interface FormNode<Value, CompleteValue = Value> {
  readonly kind: "field" | "form" | "list";
  readonly value: Atom<Value>;
  readonly completeValue: Atom<CompleteValue>;
  readonly issues: Atom<ValidationIssues | null>;
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
export type FormCompleteValue<T extends NodeMap> = { [K in keyof T]: NodeCompleteValue<T[K]> };
export type FormValue<T extends NodeMap> = Partial<{ [K in keyof T]: NodeValue<T[K]> }>;

/* ── Internal helpers ─────────────────────────────────── */

const normalize = <T>(v?: T | readonly T[]): T[] =>
  v == null ? [] : Array.isArray(v) ? [...v] : [v as T];

const isEmpty = (v: unknown): boolean =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

const teardown = (s: Subscription | (() => void) | undefined): void => {
  if (!s) return;
  try { typeof s === "function" ? s() : (s as () => void)(); } catch {}
};

function mergeIssues(...sources: readonly (ValidationIssues | null | undefined)[]): ValidationIssues | null {
  let merged: Record<string, unknown> | undefined;
  for (const s of sources) {
    if (!s) continue;
    merged ??= {};
    Object.assign(merged, s);
  }
  return merged ? Object.freeze(merged) : null;
}

function shallowEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left == null || right == null) return false;

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((v, i) => Object.is(v, right[i]));
  }

  if (typeof left === "object" && typeof right === "object") {
    const lk = Reflect.ownKeys(left as object);
    const rk = Reflect.ownKeys(right as object);
    return lk.length === rk.length && lk.every(k => Object.is((left as any)[k], (right as any)[k]));
  }

  return false;
}

function setIfChanged<T>(target: Writable<T>, next: T): boolean {
  if (shallowEqual(target.value, next)) return false;
  target.set(next);
  return true;
}

function statusOf(disabled: boolean, pending: boolean, issues: ValidationIssues | null, error: unknown | null): FormStatus {
  if (disabled) return "disabled";
  if (pending) return "pending";
  if (error !== null) return "error";
  if (issues !== null) return "invalid";
  return "valid";
}

const bump = (r: Writable<number>): void => r.set(r.value + 1);

function attachRevision(revision: Writable<number>, sources: readonly Atom<unknown>[]): () => void {
  const subs = sources.map(s => s.subscribe(() => bump(revision)));
  return () => subs.forEach(teardown);
}

const subscribeToNode = (node: FormNode<any, any>, cb: () => void): (() => void) =>
  (node as FormNode<any, any> & InternalNode)[FORM_REVISION].subscribe(cb);

export function watchNode(node: FormNode<any, any>, callback: () => void): () => void {
  return subscribeToNode(node, callback);
}

/* ── Aggregate state (shared by form & list) ──────────── */

interface AggregateAtoms {
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

function createAggregateAtoms(disabled: boolean): AggregateAtoms {
  return {
    issues: atom<ValidationIssues | null>(null),
    validationError: atom<unknown | null>(null),
    status: atom<FormStatus>(disabled ? "disabled" : "valid"),
    valid: atom(disabled),
    invalid: atom(false),
    pending: atom(false),
    dirty: atom(false),
    touched: atom(false),
    revision: atom(0),
  };
}

function syncAggregate(
  state: AggregateAtoms,
  disabled: boolean,
  issues: ValidationIssues | null,
  error: unknown | null,
  pending: boolean,
  dirty: boolean,
  touched: boolean,
  valueChanged: boolean,
): void {
  const status = statusOf(disabled, pending, issues, error);
  let changed = valueChanged;
  changed = setIfChanged(state.issues, issues) || changed;
  changed = setIfChanged(state.validationError, error) || changed;
  changed = setIfChanged(state.pending, pending) || changed;
  changed = setIfChanged(state.dirty, dirty) || changed;
  changed = setIfChanged(state.touched, touched) || changed;
  changed = setIfChanged(state.status, status) || changed;
  changed = setIfChanged(state.valid, status === "valid" || status === "disabled") || changed;
  changed = setIfChanged(state.invalid, status === "invalid") || changed;
  if (changed) bump(state.revision);
}

interface AggregateInputs {
  readonly disabled: boolean;
  readonly issues: ValidationIssues | null;
  readonly validationError: unknown | null;
  readonly pending: boolean;
  readonly dirty: boolean;
  readonly touched: boolean;
}

const aggregateArray = <N extends FormNode<any, any>>(children: readonly N[], groupDisabled: boolean) => {
  const enabled: Array<NodeValue<N>> = [];
  const complete: Array<NodeCompleteValue<N>> = [];
  const issuesByIndex: Record<number, unknown> = {};
  const errorsByIndex: Record<number, unknown> = {};
  let pending = false, dirty = false, touched = false;

  children.forEach((child, index) => {
    complete.push(child.completeValue.value);
    dirty ||= child.dirty.value;
    touched ||= child.touched.value;
    if (child.disabled.value) return;
    enabled.push(child.value.value);
    pending ||= child.pending.value;
    if (child.issues.value) issuesByIndex[index] = child.issues.value;
    if (child.validationError.value !== null) errorsByIndex[index] = child.validationError.value;
  });

  return {
    value: groupDisabled ? [] : enabled,
    completeValue: complete,
    aggregate: {
      disabled: groupDisabled,
      issues: groupDisabled || Object.keys(issuesByIndex).length === 0 ? null : Object.freeze(issuesByIndex),
      validationError: groupDisabled || Object.keys(errorsByIndex).length === 0 ? null : Object.freeze(errorsByIndex),
      pending: !groupDisabled && pending,
      dirty,
      touched,
    } as AggregateInputs,
  };
};

const aggregateRecord = <T extends NodeMap>(children: Readonly<T>, groupDisabled: boolean) => {
  const enabled: Record<string, unknown> = {};
  const complete: Record<string, unknown> = {};
  const issuesByKey: Record<string, unknown> = {};
  const errorsByKey: Record<string, unknown> = {};
  let pending = false, dirty = false, touched = false;

  for (const [key, child] of Object.entries(children)) {
    complete[key] = child.completeValue.value;
    dirty ||= child.dirty.value;
    touched ||= child.touched.value;
    if (child.disabled.value) continue;
    enabled[key] = child.value.value;
    pending ||= child.pending.value;
    if (child.issues.value) issuesByKey[key] = child.issues.value;
    if (child.validationError.value !== null) errorsByKey[key] = child.validationError.value;
  }

  return {
    value: groupDisabled ? {} : enabled,
    completeValue: complete,
    aggregate: {
      disabled: groupDisabled,
      issues: groupDisabled || Object.keys(issuesByKey).length === 0 ? null : Object.freeze(issuesByKey),
      validationError: groupDisabled || Object.keys(errorsByKey).length === 0 ? null : Object.freeze(errorsByKey),
      pending: !groupDisabled && pending,
      dirty,
      touched,
    } as AggregateInputs,
  };
};

/* ── Field ────────────────────────────────────────────── */

export interface Field<T> extends FormNode<T> {
  readonly kind: "field";
  readonly value: Writable<T>;
  readonly completeValue: Writable<T>;
  readonly initialValue: Atom<T>;
  readonly syncIssues: Atom<ValidationIssues | null>;
  readonly asyncIssues: Atom<ValidationIssues | null>;
}

interface FieldState<T> {
  value: Writable<T>;
  initialValue: Writable<T>;
  touched: Writable<boolean>;
  disabled: Writable<boolean>;
  syncIssues: Atom<ValidationIssues | null>;
  asyncIssues: Writable<ValidationIssues | null>;
  validationError: Writable<unknown | null>;
  pending: Writable<boolean>;
  dirty: Atom<boolean>;
  issues: Atom<ValidationIssues | null>;
  status: Atom<FormStatus>;
  valid: Atom<boolean>;
  invalid: Atom<boolean>;
  revision: Writable<number>;
}

export function field<T>(initial: T, options: FieldOptions<T> = {}): Field<T> {
  const syncChecks = normalize(options.checks);
  const asyncChecks = normalize(options.asyncChecks);
  const asyncOnlyWhenSyncClean = options.asyncOnlyWhenSyncClean ?? true;
  const asyncDelay = Math.max(0, options.asyncDelay ?? 0);

  const fieldScope = scope(() => {
    const value = atom<T>(initial);
    const initialValue = atom<T>(initial);
    const touched = atom(false);
    const disabled = atom(options.disabled ?? false);
    const asyncIssues = atom<ValidationIssues | null>(null);
    const validationError = atom<unknown | null>(null);
    const pending = atom(false);
    const revision = atom(0);

    const dirty = derived<boolean>($ => !Object.is($(value), $(initialValue)));
    const syncIssues = derived<ValidationIssues | null>($ => {
      if ($(disabled)) return null;
      return mergeIssues(...syncChecks.map(check => check($(value))));
    });
    const issues = derived<ValidationIssues | null>($ =>
      $(disabled) ? null : mergeIssues($(syncIssues), $(asyncIssues))
    );
    const status = derived<FormStatus>($ =>
      statusOf($(disabled), $(pending), $(issues), $(validationError))
    );
    const valid = derived<boolean>($ => $(status) === "valid" || $(status) === "disabled");
    const invalid = derived<boolean>($ => $(status) === "invalid");

    return { value, initialValue, touched, disabled, asyncIssues, validationError, pending, revision, dirty, syncIssues, issues, status, valid, invalid };
  });

  const at = fieldScope.at as <K extends keyof FieldState<T>>(key: K) => FieldState<T>[K];
  const value = at('value');
  const initialValue = at('initialValue');
  const touched = at('touched');
  const disabled = at('disabled');
  const asyncIssues = at('asyncIssues');
  const validationError = at('validationError');
  const pending = at('pending');
  const revision = at('revision');
  const dirty = at('dirty');
  const syncIssues = at('syncIssues');
  const issues = at('issues');
  const status = at('status');
  const valid = at('valid');
  const invalid = at('invalid');

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

    if (disabled.value || asyncChecks.length === 0 || (asyncOnlyWhenSyncClean && syncIssues.value !== null)) {
      setIfChanged(asyncIssues, null);
      return;
    }

    const currentRun = runId;
    const currentController = new AbortController();
    controller = currentController;
    setIfChanged(pending, true);

    try {
      const results = await Promise.all(
        asyncChecks.map(check => Promise.resolve(check(value.value, currentController.signal))),
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
      if (asyncDelay === 0) { void executeAsync(); return; }
      cancelAsync();
      timer = setTimeout(() => { timer = undefined; void executeAsync(); }, asyncDelay);
    });
  };

  const valueSub = value.subscribe(scheduleAsync);
  const disabledSub = disabled.subscribe(scheduleAsync);
  const syncIssuesSub = syncIssues.subscribe(scheduleAsync);
  scheduleAsync();

  const stopRevision = attachRevision(revision, [value, issues, validationError, status, dirty, touched]);

  fieldScope.cleanups.add(() => {
    if (disposed) return;
    disposed = true;
    cancelAsync();
    teardown(valueSub);
    teardown(disabledSub);
    teardown(syncIssuesSub);
    stopRevision();
  });

  const set = (next: T, writeOptions: WriteOptions = {}): void => {
    value.set(next);
    if (writeOptions.touch) touched.set(true);
  };

  function reset(): void;
  function reset(next: T, resetOptions?: ResetOptions): void;
  function reset(next?: T, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;
    const target = supplied ? (next as T) : initialValue.value;
    if (supplied && resetOptions.updateInitial) initialValue.set(target);
    value.set(target);
    touched.set(false);
  }

  return {
    kind: "field",
    value, completeValue: value, initialValue, syncIssues, asyncIssues,
    issues, validationError, status, valid, invalid, pending, dirty, touched, disabled,
    set, reset,
    touch: () => touched.set(true),
    untouch: () => touched.set(false),
    enable: () => disabled.set(false),
    disable: () => disabled.set(true),
    dispose: () => fieldScope.dispose(),
    [FORM_REVISION]: revision,
  } as Field<T> & InternalNode;
}

/* ── Form ─────────────────────────────────────────────── */

export interface Form<T extends NodeMap> extends FormNode<FormValue<T>, FormCompleteValue<T>> {
  readonly kind: "form";
  readonly value: Atom<FormValue<T>>;
  readonly completeValue: Atom<FormCompleteValue<T>>;
  readonly fields: Readonly<T>;
  patch(value: Partial<FormCompleteValue<T>>, options?: WriteOptions): void;
}

interface FormState<T extends NodeMap> extends AggregateAtoms {
  disabled: Writable<boolean>;
  valueState: Writable<FormValue<T>>;
  completeValueState: Writable<FormCompleteValue<T>>;
}

export function form<T extends NodeMap>(fields: T, options: GroupOptions = {}): Form<T> {
  const ownsChildren = options.ownsChildren ?? true;
  const children = Object.freeze({ ...fields }) as Readonly<T>;

  const formScope = scope(() => {
    const disabled = atom(options.disabled ?? false);
    const valueState = atom<FormValue<T>>({});
    const completeValueState = atom<FormCompleteValue<T>>({} as FormCompleteValue<T>);
    const agg = createAggregateAtoms(disabled.value);
    return { disabled, valueState, completeValueState, ...agg };
  });

  const at = formScope.at as <K extends keyof FormState<T>>(key: K) => FormState<T>[K];
  const disabled = at('disabled');
  const valueState = at('valueState');
  const completeValueState = at('completeValueState');
  const agg: AggregateAtoms = {
    issues: at('issues'),
    validationError: at('validationError'),
    status: at('status'),
    valid: at('valid'),
    invalid: at('invalid'),
    pending: at('pending'),
    dirty: at('dirty'),
    touched: at('touched'),
    revision: at('revision'),
  };

  let disposed = false;
  let queued = false;

  const recompute = (): void => {
    queued = false;
    if (disposed) return;
    const groupDisabled = disabled.value;
    const result = aggregateRecord(children, groupDisabled);
    let valueChanged = setIfChanged(valueState, result.value as FormValue<T>);
    valueChanged = setIfChanged(completeValueState, result.completeValue as FormCompleteValue<T>) || valueChanged;
    syncAggregate(
      agg, 
      result.aggregate.disabled, 
      result.aggregate.issues, 
      result.aggregate.validationError, 
      result.aggregate.pending, 
      result.aggregate.dirty, 
      result.aggregate.touched,
      valueChanged
    );
  };

  const queueRecompute = (): void => {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(recompute);
  };

  const childTeardowns = Object.values(children).map(child => subscribeToNode(child, queueRecompute));
  const disabledSub = disabled.subscribe(queueRecompute);
  recompute();

  formScope.cleanups.add(() => {
    if (disposed) return;
    disposed = true;
    teardown(disabledSub);
    childTeardowns.forEach(stop => stop());
    if (ownsChildren) Object.values(children).forEach(child => child.dispose());
  });

  const set = (next: FormCompleteValue<T>, writeOptions: WriteOptions = {}): void => {
    for (const key of Object.keys(children) as Array<keyof T>) {
      children[key].set(next[key], writeOptions);
    }
  };

  const patch = (next: Partial<FormCompleteValue<T>>, writeOptions: WriteOptions = {}): void => {
    for (const key of Object.keys(next) as Array<keyof T>) {
      if (key in children) children[key].set(next[key]!, writeOptions);
    }
  };

  function reset(): void;
  function reset(next: FormCompleteValue<T>, resetOptions?: ResetOptions): void;
  function reset(next?: FormCompleteValue<T>, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;
    for (const key of Object.keys(children) as Array<keyof T>) {
      supplied ? children[key].reset(next![key], resetOptions) : children[key].reset();
    }
  }

  return {
    kind: "form",
    value: valueState, completeValue: completeValueState,
    issues: agg.issues, validationError: agg.validationError,
    status: agg.status, valid: agg.valid, invalid: agg.invalid,
    pending: agg.pending, dirty: agg.dirty, touched: agg.touched, disabled,
    fields: children,
    set, patch, reset,
    touch: () => Object.values(children).forEach(c => c.touch()),
    untouch: () => Object.values(children).forEach(c => c.untouch()),
    enable: () => disabled.set(false),
    disable: () => disabled.set(true),
    dispose: () => formScope.dispose(),
    [FORM_REVISION]: agg.revision,
  } as Form<T> & InternalNode;
}

/* ── List ─────────────────────────────────────────────── */

export interface List<N extends FormNode<any, any>>
  extends FormNode<Array<NodeValue<N>>, Array<NodeCompleteValue<N>>> {
  readonly kind: "list";
  readonly value: Atom<Array<NodeValue<N>>>;
  readonly completeValue: Atom<Array<NodeCompleteValue<N>>>;
  readonly items: readonly N[];
  push(item: N): void;
  insert(index: number, item: N): void;
  removeAt(index: number): void;
  detachAt(index: number): N | undefined;
  clear(): void;
}

interface ListState<N extends FormNode<any, any>> extends AggregateAtoms {
  disabled: Writable<boolean>;
  valueState: Writable<Array<NodeValue<N>>>;
  completeValueState: Writable<Array<NodeCompleteValue<N>>>;
}

export function list<N extends FormNode<any, any>>(
  initial: readonly N[] = [],
  options: GroupOptions = {},
): List<N> {
  const ownsChildren = options.ownsChildren ?? true;
  const children: N[] = [...initial];

  const listScope = scope(() => {
    const disabled = atom(options.disabled ?? false);
    const valueState = atom<Array<NodeValue<N>>>([]);
    const completeValueState = atom<Array<NodeCompleteValue<N>>>([]);
    const agg = createAggregateAtoms(disabled.value);
    return { disabled, valueState, completeValueState, ...agg };
  });

  const at = listScope.at as <K extends keyof ListState<N>>(key: K) => ListState<N>[K];
  const disabled = at('disabled');
  const valueState = at('valueState');
  const completeValueState = at('completeValueState');
  const agg: AggregateAtoms = {
    issues: at('issues'),
    validationError: at('validationError'),
    status: at('status'),
    valid: at('valid'),
    invalid: at('invalid'),
    pending: at('pending'),
    dirty: at('dirty'),
    touched: at('touched'),
    revision: at('revision'),
  };

  const subscriptions = new Map<N, () => void>();
  let disposed = false;
  let queued = false;

  const recompute = (): void => {
    queued = false;
    if (disposed) return;
    const groupDisabled = disabled.value;
    const result = aggregateArray(children, groupDisabled);
    let valueChanged = setIfChanged(valueState, result.value as Array<NodeValue<N>>);
    valueChanged = setIfChanged(completeValueState, result.completeValue as Array<NodeCompleteValue<N>>) || valueChanged;
    syncAggregate(
      agg, 
      result.aggregate.disabled, 
      result.aggregate.issues, 
      result.aggregate.validationError, 
      result.aggregate.pending, 
      result.aggregate.dirty, 
      result.aggregate.touched,
      valueChanged
    );
  };

  const queueRecompute = (): void => {
    if (disposed || queued) return;
    queued = true;
    queueMicrotask(recompute);
  };

  const attach = (child: N): void => {
    if (subscriptions.has(child)) throw new Error("The same form node cannot be attached to a list twice.");
    subscriptions.set(child, subscribeToNode(child, queueRecompute));
  };

  const detach = (child: N): void => {
    subscriptions.get(child)?.();
    subscriptions.delete(child);
  };

  initial.forEach(attach);
  const disabledSub = disabled.subscribe(queueRecompute);
  recompute();

  listScope.cleanups.add(() => {
    if (disposed) return;
    disposed = true;
    teardown(disabledSub);
    [...children].forEach(child => { detach(child); if (ownsChildren) child.dispose(); });
    children.length = 0;
  });

  const items = new Proxy(children as readonly N[], {
    get(target, property, receiver) {
      if (ARRAY_MUTATORS.has(property)) {
        return () => { throw new TypeError("List items are read-only; use list mutation methods."); };
      }
      return Reflect.get(target, property, receiver);
    },
    set() { throw new TypeError("List items are read-only; use list mutation methods."); },
    deleteProperty() { throw new TypeError("List items are read-only; use list mutation methods."); },
    defineProperty() { throw new TypeError("List items are read-only; use list mutation methods."); },
  });

  const set = (next: Array<NodeCompleteValue<N>>, writeOptions: WriteOptions = {}): void => {
    if (next.length !== children.length) {
      throw new RangeError(`Expected ${children.length} values, received ${next.length}.`);
    }
    children.forEach((child, index) => child.set(next[index], writeOptions));
  };

  const push = (child: N): void => { attach(child); children.push(child); queueRecompute(); };
  const insert = (index: number, child: N): void => {
    attach(child);
    children.splice(Math.max(0, Math.min(index, children.length)), 0, child);
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
    removed.forEach(child => { detach(child); if (ownsChildren) child.dispose(); });
    queueRecompute();
  };

  function reset(): void;
  function reset(next: Array<NodeCompleteValue<N>>, resetOptions?: ResetOptions): void;
  function reset(next?: Array<NodeCompleteValue<N>>, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;
    if (supplied && next!.length !== children.length) {
      throw new RangeError(`Expected ${children.length} values, received ${next!.length}.`);
    }
    children.forEach((child, index) => supplied ? child.reset(next![index], resetOptions) : child.reset());
  }

  return {
    kind: "list",
    value: valueState, completeValue: completeValueState,
    issues: agg.issues, validationError: agg.validationError,
    status: agg.status, valid: agg.valid, invalid: agg.invalid,
    pending: agg.pending, dirty: agg.dirty, touched: agg.touched, disabled,
    items, set, push, insert, removeAt, detachAt, clear, reset,
    touch: () => children.forEach(c => c.touch()),
    untouch: () => children.forEach(c => c.untouch()),
    enable: () => disabled.set(false),
    disable: () => disabled.set(true),
    dispose: () => listScope.dispose(),
    [FORM_REVISION]: agg.revision,
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
        ? { minLength: { required: minimum, actual: length } } : null;
    };
  },
  maxLength(maximum: number): Check<unknown> {
    return value => {
      if (isEmpty(value)) return null;
      const length = (value as { length?: unknown }).length;
      return typeof length === "number" && length > maximum
        ? { maxLength: { required: maximum, actual: length } } : null;
    };
  },
  number(value: unknown): ValidationIssues | null {
    if (isEmpty(value)) return null;
    if (typeof value === "number") return Number.isFinite(value) ? null : { number: true };
    if (typeof value !== "string" || value.trim() === "") return { number: true };
    return Number.isFinite(Number(value)) ? null : { number: true };
  },
  min(minimum: number): Check<unknown> {
    return value => {
      if (isEmpty(value)) return null;
      const numeric = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numeric)) return { number: true };
      return numeric < minimum ? { min: { required: minimum, actual: numeric } } : null;
    };
  },
  max(maximum: number): Check<unknown> {
    return value => {
      if (isEmpty(value)) return null;
      const numeric = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numeric)) return { number: true };
      return numeric > maximum ? { max: { required: maximum, actual: numeric } } : null;
    };
  },
  pattern(pattern: string | RegExp): Check<unknown> {
    const expression = typeof pattern === "string"
      ? new RegExp(`^(?:${pattern})$`)
      : new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    return value => isEmpty(value) ? null : (expression.test(String(value)) ? null : { pattern: { required: pattern.toString(), actual: value } });
  },
  email(value: unknown): ValidationIssues | null {
    return isEmpty(value) ? null : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : { email: true });
  },
  compose<T>(...items: readonly Check<T>[]): Check<T> {
    return value => mergeIssues(...items.map(check => check(value)));
  },
  composeAsync<T>(...items: readonly AsyncCheck<T>[]): AsyncCheck<T> {
    return async (value, signal) => {
      const results = await Promise.all(items.map(check => Promise.resolve(check(value, signal))));
      return mergeIssues(...results);
    };
  },
});