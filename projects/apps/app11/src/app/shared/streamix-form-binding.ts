import {
  checks,
  formatFieldError,
  watchNode,
  type Check,
  type Field,
  type Form,
  type FormNode,
} from "@epikodelabs/streamix/forms";

type NativeFieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type ElementKind = "checkbox" | "radio" | "number" | "select" | "text";

interface BoundControl {
  readonly element: NativeFieldElement;
  readonly field: Field<unknown>;
  readonly dispose: () => void;
}

export interface StreamixFormBinding {
  refresh(): void;
  dispose(): void;
}

export function bindStreamixForm(root: HTMLFormElement, form: Form<any>): StreamixFormBinding {
  const controls = new Map<NativeFieldElement, BoundControl>();
  const observer = new MutationObserver(() => refresh());

  root.noValidate = true;
  refresh();

  observer.observe(root, { childList: true, subtree: true });

  return {
    refresh,
    dispose() {
      observer.disconnect();
      controls.forEach((c) => c.dispose());
      controls.clear();
    },
  };

  function refresh() {
    controls.forEach((c) => c.dispose());
    controls.clear();
    root.noValidate = true;

    root
      .querySelectorAll<NativeFieldElement>("input[name], textarea[name], select[name]")
      .forEach((element) => {
        const field = resolveField(form, element.name);
        if (!field) return;
        controls.set(element, bindControl(element, field));
      });
  }
}

// --- Path resolution helpers (exported for the component) ---

export function resolveNode(root: Form<any>, path: string): FormNode<any, any> | undefined {
  const segments = path.split(".").filter(Boolean);
  let current: FormNode<any, any> = root;

  for (const segment of segments) {
    if (current.kind === "form") {
      const next = (current as Form<any>).fields[segment] as FormNode<any, any> | undefined;
      if (!next) return undefined;
      current = next;
      continue;
    }
    if (current.kind === "list") {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      const next = (current as unknown as { items: readonly FormNode<any, any>[] }).items[index];
      if (!next) return undefined;
      current = next;
      continue;
    }
    return undefined;
  }
  return current;
}

export function resolveField(root: Form<any>, path: string): Field<unknown> | undefined {
  const node = resolveNode(root, path);
  return node?.kind === "field" ? (node as Field<unknown>) : undefined;
}

export function fieldError(root: Form<any>, path: string, pendingHint?: string): string | null {
  const field = resolveField(root, path);
  return field ? formatFieldError(field, undefined, pendingHint) : null;
}

export function fieldHint(root: Form<any>, path: string, pendingHint?: string): string | null {
  const field = resolveField(root, path);
  return field && pendingHint && field.pending.value ? pendingHint : null;
}

// --- Control binding (private) ---

function bindControl(element: NativeFieldElement, field: Field<unknown>): BoundControl {
  const nativeSource = {};
  const kind = detectKind(element);

  field.useValidation(nativeSource, {
    checks: collectNativeChecks(element, kind),
  });

  const render = () => {
    element.disabled = field.disabled.value;
    writeControlValue(element, kind, field.completeValue.value);

    const invalid = field.invalid.value && (field.dirty.value || field.touched.value);
    element.classList.toggle("is-invalid", invalid);
    element.classList.toggle("is-pending", field.pending.value);
    element.setAttribute("aria-invalid", String(invalid));
  };

  const handleInput = () => {
    if (usesInputEvent(kind)) field.set(readControlValue(element, kind));
  };
  const handleChange = () => {
    if (!usesInputEvent(kind)) {
      if (kind === "radio" && element instanceof HTMLInputElement && !element.checked) return;
      field.set(readControlValue(element, kind));
    }
  };
  const handleBlur = () => field.touch();

  element.addEventListener("input", handleInput);
  element.addEventListener("change", handleChange);
  element.addEventListener("blur", handleBlur);

  const stopWatching = watchNode(field, render);
  render();

  return {
    element,
    field,
    dispose() {
      element.removeEventListener("input", handleInput);
      element.removeEventListener("change", handleChange);
      element.removeEventListener("blur", handleBlur);
      stopWatching();
      if (!field.state.disposed) {
        field.clearValidation(nativeSource);
      }
    },
  };
}

// --- Helpers (unchanged) ---

function detectKind(element: NativeFieldElement): ElementKind {
  if (element instanceof HTMLSelectElement) return "select";
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";
    if (element.type === "number" || element.type === "range") return "number";
  }
  return "text";
}

function usesInputEvent(kind: ElementKind): boolean {
  return kind !== "select" && kind !== "checkbox" && kind !== "radio";
}

function readControlValue(element: NativeFieldElement, kind: ElementKind): unknown {
  if (element instanceof HTMLInputElement) {
    switch (kind) {
      case "checkbox":
        return element.checked;
      case "number":
        return element.value === "" ? null : element.valueAsNumber;
      case "radio":
        return element.value;
    }
  }
  return element.value;
}

function writeControlValue(element: NativeFieldElement, kind: ElementKind, value: unknown): void {
  if (element instanceof HTMLInputElement) {
    if (kind === "checkbox") {
      element.checked = Boolean(value);
      return;
    }
    if (kind === "radio") {
      element.checked = String(value ?? "") === element.value;
      return;
    }
  }
  const rendered = value == null ? "" : String(value);
  if (element.value !== rendered) element.value = rendered;
}

function collectNativeChecks(element: NativeFieldElement, kind: ElementKind): Check<unknown>[] {
  const nativeChecks: Check<unknown>[] = [];

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.required) {
      nativeChecks.push(kind === "checkbox" ? checks.requiredTrue : checks.required);
    }
    if (element.minLength >= 0 && element.hasAttribute("minlength")) {
      nativeChecks.push(checks.minLength(element.minLength));
    }
    if (element.maxLength >= 0 && element.hasAttribute("maxlength")) {
      nativeChecks.push(checks.maxLength(element.maxLength));
    }
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === "email") nativeChecks.push(checks.email);
    if (element.pattern) nativeChecks.push(checks.pattern(element.pattern));
    if (kind === "number" && element.min !== "") {
      const min = Number(element.min);
      if (Number.isFinite(min)) nativeChecks.push(checks.min(min));
    }
    if (kind === "number" && element.max !== "") {
      const max = Number(element.max);
      if (Number.isFinite(max)) nativeChecks.push(checks.max(max));
    }
  }

  return nativeChecks;
}