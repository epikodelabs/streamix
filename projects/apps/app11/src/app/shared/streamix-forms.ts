import { atom, type Atom, type Subscription, type Writable } from '@epikodelabs/streamix';

export type ValidationIssues = Readonly<Record<string, unknown>>;
export type MaybePromise<T> = T | PromiseLike<T>;
export type Check<T> = (value: T) => ValidationIssues | null;
export type AsyncCheck<T> = (value: T, signal: AbortSignal) => MaybePromise<ValidationIssues | null>;
export type FormStatus = 'valid' | 'invalid' | 'pending' | 'disabled' | 'error';

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
export interface FormOptions<T extends NodeMap> extends GroupOptions {
  checks?: Check<FormCompleteValue<T>> | readonly Check<FormCompleteValue<T>>[];
}

export interface StateView<T> {
  readonly value: T;
  readonly previous: T;
  readonly disposed: boolean;
  readonly error?: unknown;
  subscribe(callback: (value: T, previous: T) => MaybePromise<void>): Subscription;
}
export interface WritableStateView<T> extends StateView<T> {
  set(value: T): void;
  next(value: T): void;
}

export interface NodeState<Value, CompleteValue = Value> {
  readonly value: Value;
  readonly completeValue: CompleteValue;
  readonly issues: ValidationIssues | null;
  readonly validationError: unknown | null;
  readonly status: FormStatus;
  readonly valid: boolean;
  readonly invalid: boolean;
  readonly pending: boolean;
  readonly dirty: boolean;
  readonly touched: boolean;
  readonly disabled: boolean;
}

export interface FormNode<Value, CompleteValue = Value> {
  readonly kind: 'field' | 'form' | 'list';
  readonly state: Atom<NodeState<Value, CompleteValue>>;
  readonly value: StateView<Value>;
  readonly completeValue: StateView<CompleteValue>;
  readonly issues: StateView<ValidationIssues | null>;
  readonly validationError: StateView<unknown | null>;
  readonly status: StateView<FormStatus>;
  readonly valid: StateView<boolean>;
  readonly invalid: StateView<boolean>;
  readonly pending: StateView<boolean>;
  readonly dirty: StateView<boolean>;
  readonly touched: StateView<boolean>;
  readonly disabled: WritableStateView<boolean>;
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

type Selector<S, T> = (state: S) => T;

function view<S, T>(source: Atom<S>, select: Selector<S, T>): StateView<T> {
  return {
    get value() { return select(source.value); },
    get previous() { return select(source.previous ?? source.value); },
    get disposed() { return source.disposed; },
    get error() { return source.error; },
    subscribe(callback) {
      let previous = select(source.value);
      return source.subscribe(async current => {
        const next = select(current);
        if (Object.is(next, previous)) return;
        const old = previous;
        previous = next;
        await callback(next, old);
      });
    },
  };
}

function writableView<S, T>(source: Writable<S>, select: Selector<S, T>, write: (value: T) => void): WritableStateView<T> {
  const projected = view(source, select);
  return {
    get value() { return projected.value; },
    get previous() { return projected.previous; },
    get disposed() { return projected.disposed; },
    get error() { return projected.error; },
    subscribe: callback => projected.subscribe(callback),
    set: write,
    next: write,
  };
}

const normalize = <T>(value?: T | readonly T[]): T[] =>
  value == null ? [] : Array.isArray(value) ? [...value] : [value as T];

const isEmpty = (value: unknown): boolean =>
  value == null || value === '' || (Array.isArray(value) && value.length === 0);

function mergeIssues(...sources: readonly (ValidationIssues | null | undefined)[]): ValidationIssues | null {
  let result: Record<string, unknown> | undefined;
  for (const source of sources) {
    if (!source) continue;
    result ??= {};
    Object.assign(result, source);
  }
  return result ? Object.freeze(result) : null;
}

function statusOf(disabled: boolean, pending: boolean, issues: ValidationIssues | null, error: unknown | null): FormStatus {
  if (disabled) return 'disabled';
  if (pending) return 'pending';
  if (error !== null) return 'error';
  if (issues !== null) return 'invalid';
  return 'valid';
}

function keyed(entries: readonly (readonly [PropertyKey, unknown])[]): ValidationIssues | null {
  if (!entries.length) return null;
  const result: Record<PropertyKey, unknown> = {};
  for (const [key, value] of entries) result[key] = value;
  return Object.freeze(result) as ValidationIssues;
}

export interface FieldState<T> extends NodeState<T> {
  readonly initialValue: T;
  readonly syncIssues: ValidationIssues | null;
  readonly asyncIssues: ValidationIssues | null;
}

export interface Field<T> extends FormNode<T> {
  readonly kind: 'field';
  readonly state: Atom<FieldState<T>>;
  readonly value: WritableStateView<T>;
  readonly completeValue: WritableStateView<T>;
  readonly initialValue: StateView<T>;
  readonly syncIssues: StateView<ValidationIssues | null>;
  readonly asyncIssues: StateView<ValidationIssues | null>;
}

export function field<T>(initial: T, options: FieldOptions<T> = {}): Field<T> {
  const syncChecks = normalize(options.checks);
  const asyncChecks = normalize(options.asyncChecks);
  const asyncOnlyWhenSyncClean = options.asyncOnlyWhenSyncClean ?? true;
  const asyncDelay = Math.max(0, options.asyncDelay ?? 0);
  let disposed = false;
  let run = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const runSync = (value: T, disabled: boolean) => {
    if (disabled) return { issues: null as ValidationIssues | null, error: null as unknown | null };
    try {
      return { issues: mergeIssues(...syncChecks.map(check => check(value))), error: null as unknown | null };
    } catch (error) {
      return { issues: null as ValidationIssues | null, error };
    }
  };

  const firstSync = runSync(initial, options.disabled ?? false);
  const firstStatus = statusOf(options.disabled ?? false, false, firstSync.issues, firstSync.error);
  const state = atom<FieldState<T>>({
    value: initial,
    completeValue: initial,
    initialValue: initial,
    syncIssues: firstSync.issues,
    asyncIssues: null,
    issues: firstSync.issues,
    validationError: firstSync.error,
    status: firstStatus,
    valid: firstStatus === 'valid' || firstStatus === 'disabled',
    invalid: firstStatus === 'invalid',
    pending: false,
    dirty: false,
    touched: false,
    disabled: options.disabled ?? false,
  });

  const publish = (patch: Partial<FieldState<T>>) => {
    if (disposed) return;
    const candidate = { ...state.value, ...patch };
    const issues = candidate.disabled ? null : mergeIssues(candidate.syncIssues, candidate.asyncIssues);
    const status = statusOf(candidate.disabled, candidate.pending, issues, candidate.validationError);
    state.set({
      ...candidate,
      completeValue: candidate.value,
      issues,
      status,
      valid: status === 'valid' || status === 'disabled',
      invalid: status === 'invalid',
      dirty: !Object.is(candidate.value, candidate.initialValue),
    });
  };

  const cancelAsync = (clearPending = true) => {
    run++;
    controller?.abort();
    controller = undefined;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (clearPending && state.value.pending) publish({ pending: false });
  };

  const executeAsync = async () => {
    if (disposed) return;
    cancelAsync(false);
    const snapshot = state.value;
    if (
      snapshot.disabled ||
      asyncChecks.length === 0 ||
      snapshot.validationError !== null ||
      (asyncOnlyWhenSyncClean && snapshot.syncIssues !== null)
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
        asyncChecks.map(check => Promise.resolve(check(snapshot.value, currentController.signal))),
      );
      if (disposed || currentController.signal.aborted || currentRun !== run) return;
      publish({ asyncIssues: mergeIssues(...results), validationError: null });
    } catch (error) {
      if (disposed || currentController.signal.aborted || currentRun !== run) return;
      publish({
        validationError: error,
        asyncIssues: options.asyncFailureToIssues?.(error) ?? null,
      });
    } finally {
      if (!disposed && currentRun === run) {
        controller = undefined;
        publish({ pending: false });
      }
    }
  };

  const scheduleAsync = () => {
    if (disposed) return;
    cancelAsync();
    if (!asyncChecks.length) return;
    if (!asyncDelay) void executeAsync();
    else timer = setTimeout(() => { timer = undefined; void executeAsync(); }, asyncDelay);
  };

  const writeValue = (value: T, writeOptions: WriteOptions = {}) => {
    const current = state.value;
    const sync = runSync(value, current.disabled);
    publish({
      value,
      touched: writeOptions.touch ? true : current.touched,
      syncIssues: sync.issues,
      asyncIssues: null,
      validationError: sync.error,
      pending: false,
    });
    scheduleAsync();
  };

  const disabled = writableView(state, s => s.disabled, next => {
    const sync = runSync(state.value.value, next);
    publish({ disabled: next, syncIssues: sync.issues, asyncIssues: null, validationError: sync.error, pending: false });
    scheduleAsync();
  });

  function reset(): void;
  function reset(next: T, resetOptions?: ResetOptions): void;
  function reset(next?: T, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;
    const current = state.value;
    const value = supplied ? next as T : current.initialValue;
    const initialValue = supplied && resetOptions.updateInitial ? value : current.initialValue;
    const sync = runSync(value, current.disabled);
    cancelAsync(false);
    publish({ value, initialValue, touched: false, pending: false, syncIssues: sync.issues, asyncIssues: null, validationError: sync.error });
    scheduleAsync();
  }

  scheduleAsync();

  return {
    kind: 'field', state,
    value: writableView(state, s => s.value, next => writeValue(next)),
    completeValue: writableView(state, s => s.completeValue, next => writeValue(next)),
    initialValue: view(state, s => s.initialValue),
    syncIssues: view(state, s => s.syncIssues),
    asyncIssues: view(state, s => s.asyncIssues),
    issues: view(state, s => s.issues),
    validationError: view(state, s => s.validationError),
    status: view(state, s => s.status),
    valid: view(state, s => s.valid),
    invalid: view(state, s => s.invalid),
    pending: view(state, s => s.pending),
    dirty: view(state, s => s.dirty),
    touched: view(state, s => s.touched),
    disabled,
    set: writeValue,
    reset,
    touch: () => publish({ touched: true }),
    untouch: () => publish({ touched: false }),
    enable: () => disabled.set(false),
    disable: () => disabled.set(true),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAsync(false);
      state.dispose();
    },
  };
}

export interface Form<T extends NodeMap> extends FormNode<FormValue<T>, FormCompleteValue<T>> {
  readonly kind: 'form';
  readonly fields: Readonly<T>;
  patch(value: Partial<FormCompleteValue<T>>, options?: WriteOptions): void;
}

export function form<T extends NodeMap>(fields: T, options: FormOptions<T> = {}): Form<T> {
  const children = Object.freeze({ ...fields }) as Readonly<T>;
  const ownsChildren = options.ownsChildren ?? true;
  const checks = normalize(options.checks);
  let disposed = false;

  const calculate = (disabled: boolean): NodeState<FormValue<T>, FormCompleteValue<T>> => {
    const value: Record<string, unknown> = {};
    const completeValue: Record<string, unknown> = {};
    const issueEntries: Array<readonly [PropertyKey, unknown]> = [];
    const errorEntries: Array<readonly [PropertyKey, unknown]> = [];
    let pending = false, dirty = false, touched = false;

    for (const [key, child] of Object.entries(children)) {
      completeValue[key] = child.completeValue.value;
      if (!child.disabled.value) value[key] = child.value.value;
      if (child.issues.value !== null) issueEntries.push([key, child.issues.value]);
      if (child.validationError.value !== null) errorEntries.push([key, child.validationError.value]);
      pending ||= child.pending.value;
      dirty ||= child.dirty.value;
      touched ||= child.touched.value;
    }

    if (!disabled && checks.length) {
      try {
        const own = mergeIssues(...checks.map(check => check(completeValue as FormCompleteValue<T>)));
        if (own) issueEntries.push(['$form', own]);
      } catch (error) {
        errorEntries.push(['$form', error]);
      }
    }

    const issues = disabled ? null : keyed(issueEntries);
    const validationError = disabled ? null : keyed(errorEntries);
    const status = statusOf(disabled, !disabled && pending, issues, validationError);
    return {
      value: (disabled ? {} : value) as FormValue<T>,
      completeValue: completeValue as FormCompleteValue<T>,
      issues, validationError, status,
      valid: status === 'valid' || status === 'disabled',
      invalid: status === 'invalid',
      pending: !disabled && pending,
      dirty, touched, disabled,
    };
  };

  const state = atom(calculate(options.disabled ?? false));
  const refresh = (disabled = state.value.disabled) => { if (!disposed) state.set(calculate(disabled)); };
  const subscriptions = Object.values(children).map(child => child.state.subscribe(() => refresh()));
  const disabled = writableView(state, s => s.disabled, refresh);

  const set = (next: FormCompleteValue<T>, writeOptions: WriteOptions = {}) => {
    for (const key of Object.keys(children) as Array<keyof T>) children[key].set(next[key], writeOptions);
    refresh();
  };
  const patch = (next: Partial<FormCompleteValue<T>>, writeOptions: WriteOptions = {}) => {
    for (const key of Object.keys(next) as Array<keyof T>) if (key in children) children[key].set(next[key]!, writeOptions);
    refresh();
  };
  function reset(): void;
  function reset(next: FormCompleteValue<T>, resetOptions?: ResetOptions): void;
  function reset(next?: FormCompleteValue<T>, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;
    for (const key of Object.keys(children) as Array<keyof T>) {
      supplied ? children[key].reset((next as FormCompleteValue<T>)[key], resetOptions) : children[key].reset();
    }
    refresh();
  }

  return {
    kind: 'form', state, fields: children,
    value: view(state, s => s.value),
    completeValue: view(state, s => s.completeValue),
    issues: view(state, s => s.issues),
    validationError: view(state, s => s.validationError),
    status: view(state, s => s.status),
    valid: view(state, s => s.valid),
    invalid: view(state, s => s.invalid),
    pending: view(state, s => s.pending),
    dirty: view(state, s => s.dirty),
    touched: view(state, s => s.touched),
    disabled,
    set, patch, reset,
    touch() { Object.values(children).forEach(child => child.touch()); refresh(); },
    untouch() { Object.values(children).forEach(child => child.untouch()); refresh(); },
    enable: () => disabled.set(false),
    disable: () => disabled.set(true),
    dispose() {
      if (disposed) return;
      disposed = true;
      subscriptions.forEach(unsubscribe => { try { unsubscribe(); } catch {} });
      state.dispose();
      if (ownsChildren) Object.values(children).forEach(child => child.dispose());
    },
  };
}

export interface List<N extends FormNode<any, any>> extends FormNode<Array<NodeValue<N>>, Array<NodeCompleteValue<N>>> {
  readonly kind: 'list';
  readonly items: readonly N[];
  push(item: N): void;
  insert(index: number, item: N): void;
  removeAt(index: number): void;
  detachAt(index: number): N | undefined;
  clear(): void;
}

const MUTATORS = new Set<PropertyKey>(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'copyWithin', 'fill']);

export function list<N extends FormNode<any, any>>(initial: readonly N[] = [], options: GroupOptions = {}): List<N> {
  const children = [...initial];
  const ownsChildren = options.ownsChildren ?? true;
  const childSubscriptions = new Map<N, Subscription>();
  let disposed = false;

  const calculate = (disabled: boolean): NodeState<Array<NodeValue<N>>, Array<NodeCompleteValue<N>>> => {
    const value: Array<NodeValue<N>> = [];
    const completeValue: Array<NodeCompleteValue<N>> = [];
    const issueEntries: Array<readonly [PropertyKey, unknown]> = [];
    const errorEntries: Array<readonly [PropertyKey, unknown]> = [];
    let pending = false, dirty = false, touched = false;

    children.forEach((child, index) => {
      completeValue.push(child.completeValue.value);
      if (!child.disabled.value) value.push(child.value.value);
      if (child.issues.value !== null) issueEntries.push([index, child.issues.value]);
      if (child.validationError.value !== null) errorEntries.push([index, child.validationError.value]);
      pending ||= child.pending.value;
      dirty ||= child.dirty.value;
      touched ||= child.touched.value;
    });

    const issues = disabled ? null : keyed(issueEntries);
    const validationError = disabled ? null : keyed(errorEntries);
    const status = statusOf(disabled, !disabled && pending, issues, validationError);
    return {
      value: disabled ? [] : value,
      completeValue, issues, validationError, status,
      valid: status === 'valid' || status === 'disabled',
      invalid: status === 'invalid',
      pending: !disabled && pending,
      dirty, touched, disabled,
    };
  };

  const state = atom(calculate(options.disabled ?? false));
  const refresh = (disabled = state.value.disabled) => { if (!disposed) state.set(calculate(disabled)); };
  const observe = (child: N) => childSubscriptions.set(child, child.state.subscribe(() => refresh()));
  const unobserve = (child: N) => { const sub = childSubscriptions.get(child); childSubscriptions.delete(child); try { sub?.(); } catch {} };
  children.forEach(observe);
  const disabled = writableView(state, s => s.disabled, refresh);

  const items = new Proxy(children as readonly N[], {
    get(target, property, receiver) {
      if (MUTATORS.has(property)) return () => { throw new TypeError('List items are read-only; use list mutation methods.'); };
      return Reflect.get(target, property, receiver);
    },
    set() { throw new TypeError('List items are read-only; use list mutation methods.'); },
    deleteProperty() { throw new TypeError('List items are read-only; use list mutation methods.'); },
    defineProperty() { throw new TypeError('List items are read-only; use list mutation methods.'); },
  });

  const set = (next: Array<NodeCompleteValue<N>>, writeOptions: WriteOptions = {}) => {
    if (next.length !== children.length) throw new RangeError(`Expected ${children.length} values, received ${next.length}.`);
    children.forEach((child, index) => child.set(next[index], writeOptions));
    refresh();
  };
  const push = (child: N) => { children.push(child); observe(child); refresh(); };
  const insert = (index: number, child: N) => { children.splice(Math.max(0, Math.min(index, children.length)), 0, child); observe(child); refresh(); };
  const detachAt = (index: number): N | undefined => {
    if (index < 0 || index >= children.length) return undefined;
    const [child] = children.splice(index, 1);
    unobserve(child);
    refresh();
    return child;
  };
  const removeAt = (index: number) => { const child = detachAt(index); if (child && ownsChildren) child.dispose(); };
  const clear = () => {
    const removed = children.splice(0, children.length);
    removed.forEach(child => { unobserve(child); if (ownsChildren) child.dispose(); });
    refresh();
  };
  function reset(): void;
  function reset(next: Array<NodeCompleteValue<N>>, resetOptions?: ResetOptions): void;
  function reset(next?: Array<NodeCompleteValue<N>>, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;
    if (supplied && next!.length !== children.length) throw new RangeError(`Expected ${children.length} values, received ${next!.length}.`);
    children.forEach((child, index) => supplied ? child.reset(next![index], resetOptions) : child.reset());
    refresh();
  }

  return {
    kind: 'list', state,
    value: view(state, s => s.value),
    completeValue: view(state, s => s.completeValue),
    issues: view(state, s => s.issues),
    validationError: view(state, s => s.validationError),
    status: view(state, s => s.status),
    valid: view(state, s => s.valid),
    invalid: view(state, s => s.invalid),
    pending: view(state, s => s.pending),
    dirty: view(state, s => s.dirty),
    touched: view(state, s => s.touched),
    disabled,
    items, set, push, insert, removeAt, detachAt, clear, reset,
    touch() { children.forEach(child => child.touch()); refresh(); },
    untouch() { children.forEach(child => child.untouch()); refresh(); },
    enable: () => disabled.set(false),
    disable: () => disabled.set(true),
    dispose() {
      if (disposed) return;
      disposed = true;
      children.forEach(unobserve);
      state.dispose();
      if (ownsChildren) children.forEach(child => child.dispose());
      children.length = 0;
    },
  };
}

export function watchNode(node: FormNode<any, any>, callback: () => void): () => void {
  const subscription = node.state.subscribe(callback);
  return () => { try { subscription(); } catch {} };
}

export function formSnapshot<N extends FormNode<any, any>>(node: N): NodeCompleteValue<N> {
  return node.completeValue.value as NodeCompleteValue<N>;
}

export function syncList<N extends FormNode<any, any>>(
  listNode: List<N>,
  next: readonly NodeCompleteValue<N>[],
  create: (value: NodeCompleteValue<N>) => N,
): void {
  while (listNode.items.length > next.length) listNode.removeAt(listNode.items.length - 1);
  while (listNode.items.length < next.length) listNode.push(create(next[listNode.items.length]));
  listNode.items.forEach((child, index) => child.reset(next[index], { updateInitial: true }));
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
  });
}

export type FieldInputType = 'text' | 'email' | 'password' | 'date' | 'textarea' | 'number' | 'range';
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
export function defineField<T>(
  node: Field<T>, label: string, type: FieldInputType = 'text',
  extras: Omit<FieldView<T>, 'node' | 'label' | 'type'> = {},
): FieldView<T> { return { node, label, type, ...extras }; }

export const defaultFieldMessages: Readonly<Record<string, string>> = Object.freeze({
  required: 'This field is required.',
  email: 'Use a valid email address.',
  pattern: 'Format is invalid.',
  passwordMismatch: 'Passwords must match.',
});
const RANGE_KEYS = new Set(['minLength', 'maxLength', 'min', 'max']);
export function formatFieldError(
  node: Field<any>,
  messages: Readonly<Record<string, string>> = defaultFieldMessages,
  pendingHint?: string,
): string | null {
  if ((pendingHint && node.pending.value) || !node.touched.value) return null;
  if (node.validationError.value !== null) return 'Validation failed.';
  const issues = node.issues.value;
  if (!issues) return null;
  const [name, payload] = Object.entries(issues)[0] ?? [];
  if (!name) return null;
  if (messages[name]) return messages[name];
  if (RANGE_KEYS.has(name)) {
    const required = typeof payload === 'object' && payload !== null && 'required' in payload
      ? String((payload as { required: unknown }).required) : '';
    return `${name.startsWith('max') ? 'Maximum' : 'Minimum'} ${name.endsWith('Length') ? 'length' : 'value'} is ${required}.`;
  }
  return 'Value is invalid.';
}
export function fieldHint(fieldView: FieldView<any>): string | null {
  if (fieldView.pendingHint && fieldView.node.pending.value) return fieldView.pendingHint;
  return fieldView.hint?.(fieldView.node.completeValue.value) ?? null;
}
export function fieldError(fieldView: FieldView<any>, messages: Readonly<Record<string, string>> = defaultFieldMessages): string | null {
  return formatFieldError(fieldView.node, messages, fieldView.pendingHint);
}

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
  required<T>(value: T) { return isEmpty(value) ? { required: true } : null; },
  requiredTrue(value: unknown) { return value === true ? null : { required: true }; },
  minLength(minimum: number): Check<unknown> { return value => {
    if (isEmpty(value)) return null;
    const length = (value as { length?: unknown }).length;
    return typeof length === 'number' && length < minimum ? { minLength: { required: minimum, actual: length } } : null;
  }; },
  maxLength(maximum: number): Check<unknown> { return value => {
    if (isEmpty(value)) return null;
    const length = (value as { length?: unknown }).length;
    return typeof length === 'number' && length > maximum ? { maxLength: { required: maximum, actual: length } } : null;
  }; },
  number(value: unknown) {
    if (isEmpty(value)) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? null : { number: true };
    if (typeof value !== 'string' || value.trim() === '') return { number: true };
    return Number.isFinite(Number(value)) ? null : { number: true };
  },
  min(minimum: number): Check<unknown> { return value => {
    if (isEmpty(value)) return null;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return { number: true };
    return numeric < minimum ? { min: { required: minimum, actual: numeric } } : null;
  }; },
  max(maximum: number): Check<unknown> { return value => {
    if (isEmpty(value)) return null;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return { number: true };
    return numeric > maximum ? { max: { required: maximum, actual: numeric } } : null;
  }; },
  pattern(pattern: string | RegExp): Check<unknown> {
    const expression = typeof pattern === 'string'
      ? new RegExp(`^(?:${pattern})$`)
      : new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
    return value => isEmpty(value) ? null : expression.test(String(value)) ? null : { pattern: { required: pattern.toString(), actual: value } };
  },
  email(value: unknown) {
    return isEmpty(value) ? null : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : { email: true };
  },
  compose<T>(...items: readonly Check<T>[]): Check<T> { return value => mergeIssues(...items.map(check => check(value))); },
  composeAsync<T>(...items: readonly AsyncCheck<T>[]): AsyncCheck<T> { return async (value, signal) => {
    const results = await Promise.all(items.map(check => Promise.resolve(check(value, signal))));
    return mergeIssues(...results);
  }; },
});
