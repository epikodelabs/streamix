// streamix-forms.ts — functional, atom-native forms for Streamix
// Refactored: Single state atom per node, zero standalone writables, unified helpers.

import { atom, derived, type Atom, type Writable } from "@epikodelabs/streamix";

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

export interface FormOptions<T extends NodeMap> extends GroupOptions {
  checks?: Check<FormCompleteValue<T>> | readonly Check<FormCompleteValue<T>>[];
}

const FORM_SIGNAL = Symbol("streamix.formSignal");
type SignalNode = { readonly [FORM_SIGNAL]: Atom<unknown> };

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

function mergeIssues(...sources: readonly (ValidationIssues | null | undefined)[]): ValidationIssues | null {
  let merged: Record<string, unknown> | undefined;
  for (const s of sources) {
    if (!s) continue;
    merged ??= {};
    Object.assign(merged, s);
  }
  return merged ? Object.freeze(merged) : null;
}

function statusOf(disabled: boolean, pending: boolean, issues: ValidationIssues | null, error: unknown | null): FormStatus {
  if (disabled) return "disabled";
  if (pending) return "pending";
  if (error !== null) return "error";
  if (issues !== null) return "invalid";
  return "valid";
}

function makeWritable<T>(source: Atom<T>, apply: (v: T) => void, root: Writable<any>): Writable<T> {
  const w = source as unknown as Writable<T>;
  w.next = (v: T) => apply(v);
  w.set = (v: T) => apply(v);
  w.fail = (err: any, opts?: any) => root.fail(err, opts);
  return w;
}

const nullErrorAtom = derived<unknown | null>(() => null);

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
  value: T;
  initialValue: T;
  touched: boolean;
  disabled: boolean;
  asyncIssues: ValidationIssues | null;
  validationError: unknown | null;
  pending: boolean;
}

export function field<T>(initial: T, options: FieldOptions<T> = {}): Field<T> {
  const syncChecks = normalize(options.checks);
  const asyncChecks = normalize(options.asyncChecks);
  const asyncOnlyWhenSyncClean = options.asyncOnlyWhenSyncClean ?? true;
  const asyncDelay = Math.max(0, options.asyncDelay ?? 0);

  const stateAtom = atom<FieldState<T>>({
    value: initial,
    initialValue: initial,
    touched: false,
    disabled: options.disabled ?? false,
    asyncIssues: null,
    validationError: null,
    pending: false,
  });

  const patchState = (patch: Partial<FieldState<T>>) =>
    stateAtom.set({ ...stateAtom.value, ...patch });

  const valueAtom = derived($ => $(stateAtom).value as unknown) as unknown as Atom<T>;
  const value = makeWritable(valueAtom, (v: T) => patchState({ value: v }), stateAtom);
  const completeValue = value;
  
  const initialValue = derived($ => $(stateAtom).initialValue as unknown) as unknown as Atom<T>;
  const touched = derived($ => $(stateAtom).touched) as unknown as Atom<boolean>;
  const pending = derived($ => $(stateAtom).pending) as unknown as Atom<boolean>;
  const validationError = derived($ => $(stateAtom).validationError) as unknown as Atom<unknown | null>;
  const asyncIssues = derived($ => $(stateAtom).asyncIssues) as unknown as Atom<ValidationIssues | null>;
  
  const disabledAtom = derived($ => $(stateAtom).disabled) as unknown as Atom<boolean>;
  const disabled = makeWritable(
    disabledAtom,
    (v: boolean) => patchState({ disabled: v }),
    stateAtom
  );

  const syncIssues = derived($ => {
    const s = $(stateAtom);
    if (s.disabled) return null;
    return mergeIssues(...syncChecks.map(c => c(s.value)));
  }) as unknown as Atom<ValidationIssues | null>;

  const issues = derived($ => {
    const s = $(stateAtom);
    if (s.disabled) return null;
    return mergeIssues($(syncIssues), s.asyncIssues);
  }) as unknown as Atom<ValidationIssues | null>;

  const status = derived($ =>
    statusOf($(stateAtom).disabled, $(stateAtom).pending, $(issues), $(stateAtom).validationError)
  ) as unknown as Atom<FormStatus>;

  const valid = derived($ => {
    const s = $(status);
    return s === "valid" || s === "disabled";
  }) as unknown as Atom<boolean>;

  const invalid = derived($ => $(status) === "invalid") as unknown as Atom<boolean>;
  const dirty = derived($ => !Object.is($(stateAtom).value, $(stateAtom).initialValue)) as unknown as Atom<boolean>;

  const signal = derived($ => [$(stateAtom), $(issues), $(status)]) as unknown as Atom<unknown>;

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
    if (stateAtom.value.pending) patchState({ pending: false });
  };

  const executeAsync = async (): Promise<void> => {
    if (disposed) return;
    cancelAsync();
    if (stateAtom.value.validationError !== null) patchState({ validationError: null });

    const currentState = stateAtom.value;
    const currentSyncIssues = syncIssues.value;

    if (
      currentState.disabled ||
      asyncChecks.length === 0 ||
      (asyncOnlyWhenSyncClean && currentSyncIssues !== null)
    ) {
      if (currentState.asyncIssues !== null) patchState({ asyncIssues: null });
      return;
    }

    const currentRun = runId;
    const currentController = new AbortController();
    controller = currentController;
    patchState({ pending: true });

    try {
      const results = await Promise.all(
        asyncChecks.map(check => Promise.resolve(check(currentState.value, currentController.signal)))
      );
      if (disposed || currentController.signal.aborted || currentRun !== runId) return;
      const merged = mergeIssues(...results);
      if (!Object.is(stateAtom.value.asyncIssues, merged)) patchState({ asyncIssues: merged });
    } catch (error) {
      if (disposed || currentController.signal.aborted || currentRun !== runId) return;
      const fallback = options.asyncFailureToIssues?.(error) ?? null;
      patchState({ validationError: error, asyncIssues: fallback });
    } finally {
      if (!disposed && currentRun === runId) {
        controller = undefined;
        if (stateAtom.value.pending) patchState({ pending: false });
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

  const asyncTrigger = derived($ => [$(stateAtom).value, $(stateAtom).disabled, $(syncIssues)]) as unknown as Atom<unknown>;
  const triggerSub = asyncTrigger.subscribe(scheduleAsync);
  scheduleAsync();

  const ownedAtoms: Atom<unknown>[] = [
    stateAtom, syncIssues, issues, status, valid, invalid, dirty,
    signal, asyncTrigger, value, completeValue, initialValue,
    touched, pending, validationError, asyncIssues, disabled,
  ];

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cancelAsync();
    try { triggerSub(); } catch {}
    ownedAtoms.forEach(a => { try { a.dispose(); } catch {} });
  };

  const set = (next: T, writeOptions: WriteOptions = {}): void => {
    patchState({
      value: next,
      touched: writeOptions.touch ? true : stateAtom.value.touched
    });
  };

  function reset(): void;
  function reset(next: T, resetOptions?: ResetOptions): void;
  function reset(next?: T, resetOptions: ResetOptions = {}): void {
    if (arguments.length > 0) {
      const target = next as T;
      const newInitial = resetOptions.updateInitial ? target : stateAtom.value.initialValue;
      patchState({ value: target, initialValue: newInitial, touched: false });
    } else {
      patchState({ value: stateAtom.value.initialValue, touched: false });
    }
  }

  return {
    kind: "field",
    value, completeValue, initialValue, syncIssues, asyncIssues,
    issues, validationError, status, valid, invalid, pending, dirty, touched, disabled,
    set, reset,
    touch: () => patchState({ touched: true }),
    untouch: () => patchState({ touched: false }),
    enable: () => patchState({ disabled: false }),
    disable: () => patchState({ disabled: true }),
    dispose,
    [FORM_SIGNAL]: signal,
  } as Field<T> & SignalNode;
}

/* ── Form ─────────────────────────────────────────────── */

export interface Form<T extends NodeMap> extends FormNode<FormValue<T>, FormCompleteValue<T>> {
  readonly kind: "form";
  readonly fields: Readonly<T>;
  patch(value: Partial<FormCompleteValue<T>>, options?: WriteOptions): void;
}

export function form<T extends NodeMap>(fields: T, options: FormOptions<T> = {}): Form<T> {
  const ownsChildren = options.ownsChildren ?? true;
  const formChecks = normalize(options.checks);
  const children = Object.freeze({ ...fields }) as Readonly<T>;

  const stateAtom = atom<{ disabled: boolean }>({ disabled: options.disabled ?? false });
  const patchState = (patch: Partial<{ disabled: boolean }>) =>
    stateAtom.set({ ...stateAtom.value, ...patch });

  const value = derived($ => {
    const s = $(stateAtom);
    if (s.disabled) return {};
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(children)) out[key] = $(child.value);
    return out;
  }) as unknown as Atom<FormValue<T>>;

  const completeValue = derived($ => {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(children)) out[key] = $(child.completeValue);
    return out;
  }) as unknown as Atom<FormCompleteValue<T>>;

  const issues = derived($ => {
    const s = $(stateAtom);
    if (s.disabled) return null;
    const byKey: Record<string, unknown> = {};
    let hasAny = false;
    for (const [key, child] of Object.entries(children)) {
      const ci = $(child.issues);
      if (ci) { byKey[key] = ci; hasAny = true; }
    }
    if (formChecks.length > 0) {
      const cv = $(completeValue);
      const formIssues = mergeIssues(...formChecks.map(c => c(cv)));
      if (formIssues) { Object.assign(byKey, formIssues); hasAny = true; }
    }
    return hasAny ? Object.freeze(byKey) : null;
  }) as unknown as Atom<ValidationIssues | null>;

  const pending = derived($ => {
    const s = $(stateAtom);
    if (s.disabled) return false;
    for (const child of Object.values(children)) if ($(child.pending)) return true;
    return false;
  }) as unknown as Atom<boolean>;

  const dirty = derived($ => {
    for (const child of Object.values(children)) if ($(child.dirty)) return true;
    return false;
  }) as unknown as Atom<boolean>;

  const touched = derived($ => {
    for (const child of Object.values(children)) if ($(child.touched)) return true;
    return false;
  }) as unknown as Atom<boolean>;

  const status = derived($ =>
    statusOf($(stateAtom).disabled, $(pending), $(issues), null)
  ) as unknown as Atom<FormStatus>;

  const valid = derived($ => {
    const s = $(status);
    return s === "valid" || s === "disabled";
  }) as unknown as Atom<boolean>;

  const invalid = derived($ => $(status) === "invalid") as unknown as Atom<boolean>;
  const signal = derived($ => [$(completeValue), $(status), $(touched), $(stateAtom)]) as unknown as Atom<unknown>;

  const disabledAtom = derived($ => $(stateAtom).disabled) as unknown as Atom<boolean>;
  const disabled = makeWritable(
    disabledAtom,
    (v: boolean) => patchState({ disabled: v }),
    stateAtom
  );

  const ownedAtoms: Atom<unknown>[] = [
    stateAtom, value, completeValue, issues, pending, dirty, touched, status, valid, invalid, signal, disabled,
  ];

  const dispose = (): void => {
    ownedAtoms.forEach(a => { try { a.dispose(); } catch {} });
    if (ownsChildren) Object.values(children).forEach(c => c.dispose());
  };

  const set = (next: FormCompleteValue<T>, writeOptions: WriteOptions = {}): void => {
    for (const key of Object.keys(children) as Array<keyof T>) children[key].set(next[key], writeOptions);
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
      if (supplied) {
        children[key].reset((next as FormCompleteValue<T>)[key], resetOptions);
      } else {
        children[key].reset();
      }
    }
  }

  return {
    kind: "form",
    value, completeValue, issues, validationError: nullErrorAtom,
    status, valid, invalid, pending, dirty, touched, disabled,
    fields: children, set, patch, reset,
    touch: () => Object.values(children).forEach(c => c.touch()),
    untouch: () => Object.values(children).forEach(c => c.untouch()),
    enable: () => patchState({ disabled: false }),
    disable: () => patchState({ disabled: true }),
    dispose,
    [FORM_SIGNAL]: signal,
  } as Form<T> & SignalNode;
}

/* ── List ─────────────────────────────────────────────── */

export interface List<N extends FormNode<any, any>>
  extends FormNode<Array<NodeValue<N>>, Array<NodeCompleteValue<N>>> {
  readonly kind: "list";
  readonly items: readonly N[];
  push(item: N): void;
  insert(index: number, item: N): void;
  removeAt(index: number): void;
  detachAt(index: number): N | undefined;
  clear(): void;
}

const ARRAY_MUTATORS = new Set<PropertyKey>([
  "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "copyWithin", "fill",
]);

export function list<N extends FormNode<any, any>>(
  initial: readonly N[] = [],
  options: GroupOptions = {},
): List<N> {
  const ownsChildren = options.ownsChildren ?? true;
  const children: N[] = [...initial];

  const stateAtom = atom<{ disabled: boolean; version: number }>({
    disabled: options.disabled ?? false,
    version: 0,
  });
  const patchState = (patch: Partial<{ disabled: boolean; version: number }>) =>
    stateAtom.set({ ...stateAtom.value, ...patch });

  const value = derived($ => {
    const s = $(stateAtom);
    void s.version;
    if (s.disabled) return [];
    return children.map(c => $(c.value));
  }) as unknown as Atom<Array<NodeValue<N>>>;

  const completeValue = derived($ => {
    void $(stateAtom).version;
    return children.map(c => $(c.completeValue));
  }) as unknown as Atom<Array<NodeCompleteValue<N>>>;

  const issues = derived($ => {
    const s = $(stateAtom);
    void s.version;
    if (s.disabled) return null;
    const byIndex: Record<number, unknown> = {};
    let hasAny = false;
    children.forEach((child, index) => {
      const ci = $(child.issues);
      if (ci) { byIndex[index] = ci; hasAny = true; }
    });
    return hasAny ? Object.freeze(byIndex) : null;
  }) as unknown as Atom<ValidationIssues | null>;

  const pending = derived($ => {
    const s = $(stateAtom);
    void s.version;
    if (s.disabled) return false;
    return children.some(c => $(c.pending));
  }) as unknown as Atom<boolean>;

  const dirty = derived($ => {
    void $(stateAtom).version;
    return children.some(c => $(c.dirty));
  }) as unknown as Atom<boolean>;

  const touched = derived($ => {
    void $(stateAtom).version;
    return children.some(c => $(c.touched));
  }) as unknown as Atom<boolean>;

  const status = derived($ =>
    statusOf($(stateAtom).disabled, $(pending), $(issues), null)
  ) as unknown as Atom<FormStatus>;

  const valid = derived($ => {
    const s = $(status);
    return s === "valid" || s === "disabled";
  }) as unknown as Atom<boolean>;

  const invalid = derived($ => $(status) === "invalid") as unknown as Atom<boolean>;
  const signal = derived($ => [$(completeValue), $(status), $(touched), $(stateAtom)]) as unknown as Atom<unknown>;

  const disabledAtom = derived($ => $(stateAtom).disabled) as unknown as Atom<boolean>;
  const disabled = makeWritable(
    disabledAtom,
    (v: boolean) => patchState({ disabled: v }),
    stateAtom
  );

  const ownedAtoms: Atom<unknown>[] = [
    stateAtom, value, completeValue, issues, pending, dirty, touched, status, valid, invalid, signal, disabled,
  ];

  const bump = (): void => patchState({ version: stateAtom.value.version + 1 });

  const dispose = (): void => {
    ownedAtoms.forEach(a => { try { a.dispose(); } catch {} });
    [...children].forEach(child => { if (ownsChildren) child.dispose(); });
    children.length = 0;
  };

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

  const push = (child: N): void => { children.push(child); bump(); };
  const insert = (index: number, child: N): void => {
    children.splice(Math.max(0, Math.min(index, children.length)), 0, child);
    bump();
  };

  const detachAt = (index: number): N | undefined => {
    if (index < 0 || index >= children.length) return undefined;
    const [child] = children.splice(index, 1);
    bump();
    return child;
  };

  const removeAt = (index: number): void => {
    const child = detachAt(index);
    if (child && ownsChildren) child.dispose();
  };

  const clear = (): void => {
    const removed = children.splice(0, children.length);
    removed.forEach(child => { if (ownsChildren) child.dispose(); });
    bump();
  };

  function reset(): void;
  function reset(next: Array<NodeCompleteValue<N>>, resetOptions?: ResetOptions): void;
  function reset(next?: Array<NodeCompleteValue<N>>, resetOptions: ResetOptions = {}): void {
    const supplied = arguments.length > 0;
    if (supplied) {
      if (next!.length !== children.length) {
        throw new RangeError(`Expected ${children.length} values, received ${next!.length}.`);
      }
      children.forEach((child, index) => child.reset(next![index], resetOptions));
    } else {
      children.forEach(child => child.reset());
    }
  }

  return {
    kind: "list",
    value, completeValue, issues, validationError: nullErrorAtom,
    status, valid, invalid, pending, dirty, touched, disabled,
    items, set, push, insert, removeAt, detachAt, clear, reset,
    touch: () => children.forEach(c => c.touch()),
    untouch: () => children.forEach(c => c.untouch()),
    enable: () => patchState({ disabled: false }),
    disable: () => patchState({ disabled: true }),
    dispose,
    [FORM_SIGNAL]: signal,
  } as List<N> & SignalNode;
}

/* ── Unified Helpers (Moved from profile-form) ────────── */

export function watchNode(node: FormNode<any, any>, callback: () => void): () => void {
  const sub = (node as unknown as SignalNode)[FORM_SIGNAL].subscribe(callback);
  return () => { try { sub(); } catch {} };
}

export function formSnapshot<N extends FormNode<any, any>>(node: N): NodeCompleteValue<N> {
  return node.completeValue.value as NodeCompleteValue<N>;
}

export function syncList<N extends FormNode<any, any>>(
  listNode: List<N>,
  next: readonly NodeCompleteValue<N>[],
  create: (value: NodeCompleteValue<N>) => N,
): void {
  const target = next.length;
  while (listNode.items.length > target) listNode.removeAt(listNode.items.length - 1);
  while (listNode.items.length < target) listNode.push(create(next[listNode.items.length]));
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
  });
}

export type FieldInputType = "text" | "email" | "password" | "date" | "textarea" | "number" | "range";

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
  node: Field<T>,
  label: string,
  type: FieldInputType = "text",
  extras: Omit<FieldView<T>, "node" | "label" | "type"> = {},
): FieldView<T> {
  return { node, label, type, ...extras };
}

export const defaultFieldMessages: Readonly<Record<string, string>> = Object.freeze({
  required: "This field is required.",
  email: "Use a valid email address.",
  pattern: "Format is invalid.",
  usernameTaken: "That username is reserved for demos.",
  passwordMismatch: "Passwords must match.",
});

const RANGE_KEYS = new Set(["minLength", "maxLength", "min", "max"]);

export function formatFieldError(
  node: Field<any>,
  messages: Readonly<Record<string, string>> = defaultFieldMessages,
  pendingHint?: string,
): string | null {
  if ((pendingHint && node.pending.value) || !node.touched.value) return null;
  if (node.validationError.value !== null) return "Validation failed.";

  const issues = node.issues.value;
  if (!issues) return null;

  const [name, payload] = Object.entries(issues)[0] ?? [];
  if (!name) return null;
  if (messages[name]) return messages[name];

  if (RANGE_KEYS.has(name)) {
    const required =
      typeof payload === "object" && payload !== null && "required" in payload
        ? String((payload as { required: unknown }).required)
        : "";
    return `${name.startsWith("max") ? "Maximum" : "Minimum"} ${
      name.endsWith("Length") ? "length" : "value"
    } is ${required}.`;
  }

  return "Value is invalid.";
}

export function fieldHint(view: FieldView<any>): string | null {
  if (view.pendingHint && view.node.pending.value) return view.pendingHint;
  return view.hint?.(view.node.completeValue.value) ?? null;
}

export function fieldError(
  view: FieldView<any>,
  messages: Readonly<Record<string, string>> = defaultFieldMessages,
): string | null {
  return formatFieldError(view.node, messages, view.pendingHint);
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
    const expression =
      typeof pattern === "string"
        ? new RegExp(`^(?:${pattern})$`)
        : new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    return value =>
      isEmpty(value)
        ? null
        : expression.test(String(value))
          ? null
          : { pattern: { required: pattern.toString(), actual: value } };
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
  composeAsync<T>(...items: readonly AsyncCheck<T>[]): AsyncCheck<T> {
    return async (value, signal) => {
      const results = await Promise.all(items.map(check => Promise.resolve(check(value, signal))));
      return mergeIssues(...results);
    };
  },
});