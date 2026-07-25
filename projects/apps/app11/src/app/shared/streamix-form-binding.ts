import {
  checks,
  formatFieldError,
  type AsyncCheck,
  type Check,
  type Field,
  type FieldValidationSource,
  type Form,
  type FormNode,
  watchNode,
} from "@epikodelabs/streamix/forms";
import { reservedUsername } from "./profile-form";

type NativeFieldElement =
  | HTMLInputElement
  | HTMLTextAreaElement
  | HTMLSelectElement;

type ElementKind =
  | "checkbox"
  | "radio"
  | "number"
  | "select"
  | "text";

interface BoundControl {
  readonly element: NativeFieldElement;
  readonly field: Field<unknown>;
  readonly dispose: () => void;
}

interface BoundGroup {
  readonly form: Form<any>;
  readonly dispose: () => void;
}

export interface StreamixFormBinding {
  refresh(): void;
  dispose(): void;
}

export function bindStreamixForm(
  root: HTMLFormElement,
  form: Form<any>,
): StreamixFormBinding {
  const controls = new Map<NativeFieldElement, BoundControl>();
  const groups = new Map<Element, BoundGroup>();
  const observer = new MutationObserver(() => refresh());

  root.noValidate = true;
  refresh();

  observer.observe(root, {
    childList: true,
    subtree: true,
  });

  return {
    refresh,
    dispose(): void {
      observer.disconnect();
      clearControls();
      clearGroups();
    },
  };

  function refresh(): void {
    clearControls();
    clearGroups();

    root.noValidate = true;

    root
      .querySelectorAll<NativeFieldElement>(
        "input[name], textarea[name], select[name]",
      )
      .forEach(element => {
        const field = resolveField(form, element.name);
        if (!field) return;

        controls.set(
          element,
          bindControl(element, field),
        );
      });

    root
      .querySelectorAll<HTMLElement>("[sxPasswordMatch]")
      .forEach(element => {
        const group = resolveMarkedGroup(form, element);
        if (!group) return;

        groups.set(element, bindPasswordMatch(group));
      });
  }

  function clearControls(): void {
    controls.forEach(binding => binding.dispose());
    controls.clear();
  }

  function clearGroups(): void {
    groups.forEach(binding => binding.dispose());
    groups.clear();
  }
}

export function resolveNode(
  root: Form<any>,
  path: string,
): FormNode<any, any> | undefined {
  const segments = path.split(".").filter(Boolean);
  let current: FormNode<any, any> = root;

  for (const segment of segments) {
    if (current.kind === "form") {
      const next = (
        current as Form<any>
      ).fields[segment] as FormNode<any, any> | undefined;
      if (!next) return undefined;
      current = next;
      continue;
    }

    if (current.kind === "list") {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      const next = (
        current as unknown as {
          items: readonly FormNode<any, any>[];
        }
      ).items[index];
      if (!next) return undefined;
      current = next;
      continue;
    }

    return undefined;
  }

  return current;
}

export function resolveField(
  root: Form<any>,
  path: string,
): Field<unknown> | undefined {
  const node = resolveNode(root, path);
  return node?.kind === "field"
    ? node as Field<unknown>
    : undefined;
}

export function fieldError(
  root: Form<any>,
  path: string,
  pendingHint?: string,
): string | null {
  const field = resolveField(root, path);
  return field
    ? formatFieldError(field, undefined, pendingHint)
    : null;
}

export function fieldHint(
  root: Form<any>,
  path: string,
  pendingHint?: string,
): string | null {
  const field = resolveField(root, path);
  if (!field) return null;

  return pendingHint && field.pending.value
    ? pendingHint
    : null;
}

function bindControl(
  element: NativeFieldElement,
  field: Field<unknown>,
): BoundControl {
  const nativeSource = {};
  const customSource = {};
  const kind = detectKind(element);

  field.useValidation(nativeSource, {
    checks: collectNativeChecks(element, kind),
  });

  const customValidation =
    collectCustomValidation(element);
  if (customValidation) {
    field.useValidation(customSource, customValidation);
  }

  const render = (): void => {
    element.disabled = field.disabled.value;
    writeControlValue(element, kind, field.completeValue.value);

    const invalid =
      field.invalid.value &&
      (field.dirty.value || field.touched.value);

    element.classList.toggle("is-invalid", invalid);
    element.classList.toggle("is-pending", field.pending.value);
    element.setAttribute("aria-invalid", String(invalid));
  };

  const handleInput = (): void => {
    if (usesInputEvent(kind)) {
      field.set(readControlValue(element, kind));
    }
  };

  const handleChange = (): void => {
    if (!usesInputEvent(kind)) {
      if (
        kind === "radio" &&
        element instanceof HTMLInputElement &&
        !element.checked
      ) {
        return;
      }

      field.set(readControlValue(element, kind));
    }
  };

  const handleBlur = (): void => {
    field.touch();
  };

  element.addEventListener("input", handleInput);
  element.addEventListener("change", handleChange);
  element.addEventListener("blur", handleBlur);

  const stopWatching = watchNode(field, render);
  render();

  return {
    element,
    field,
    dispose(): void {
      element.removeEventListener("input", handleInput);
      element.removeEventListener("change", handleChange);
      element.removeEventListener("blur", handleBlur);
      stopWatching();

      if (!field.state.disposed) {
        field.clearValidation(nativeSource);
        field.clearValidation(customSource);
      }
    },
  };
}

function bindPasswordMatch(group: Form<any>): BoundGroup {
  const source = {};

  group.useChecks(source, value =>
    passwordMismatch(value),
  );

  return {
    form: group,
    dispose(): void {
      if (!group.state.disposed) {
        group.clearChecks(source);
      }
    },
  };
}

function resolveMarkedGroup(
  root: Form<any>,
  element: Element,
): Form<any> | undefined {
  const paths = [...element.querySelectorAll("[name]")]
    .map(control => (control as HTMLInputElement).name)
    .filter(Boolean);

  if (paths.length === 0) return undefined;

  const segments = paths
    .map(path => path.split(".").filter(Boolean));
  const first = segments[0]!;
  const prefix: string[] = [];

  for (let index = 0; index < first.length; index++) {
    const value = first[index];

    if (
      segments.every(parts => parts[index] === value)
    ) {
      prefix.push(value);
    } else {
      break;
    }
  }

  if (prefix.length === 0) return undefined;

  const node = resolveNode(root, prefix.join("."));
  return node?.kind === "form"
    ? node as Form<any>
    : undefined;
}

function collectCustomValidation(
  element: NativeFieldElement,
): FieldValidationSource<unknown> | undefined {
  if (element.hasAttribute("sxReservedUsername")) {
    const asyncChecks: AsyncCheck<unknown> = (
      value,
      signal,
    ) => typeof value === "string"
      ? reservedUsername(value, signal)
      : null;

    return {
      asyncChecks,
      asyncDelay: 250,
    };
  }

  return undefined;
}

function passwordMismatch(
  value: Record<string, unknown>,
) {
  const password =
    typeof value["password"] === "string"
      ? value["password"]
      : "";
  const confirmPassword =
    typeof value["confirmPassword"] === "string"
      ? value["confirmPassword"]
      : "";

  return password && confirmPassword && password !== confirmPassword
    ? { passwordMismatch: true }
    : null;
}

function detectKind(
  element: NativeFieldElement,
): ElementKind {
  if (element instanceof HTMLSelectElement) {
    return "select";
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";

    if (
      element.type === "number" ||
      element.type === "range"
    ) {
      return "number";
    }
  }

  return "text";
}

function usesInputEvent(kind: ElementKind): boolean {
  return kind !== "select" &&
    kind !== "checkbox" &&
    kind !== "radio";
}

function readControlValue(
  element: NativeFieldElement,
  kind: ElementKind,
): unknown {
  if (element instanceof HTMLInputElement) {
    switch (kind) {
      case "checkbox":
        return element.checked;
      case "number":
        return element.value === ""
          ? null
          : element.valueAsNumber;
      case "radio":
        return element.value;
    }
  }

  return element.value;
}

function writeControlValue(
  element: NativeFieldElement,
  kind: ElementKind,
  value: unknown,
): void {
  if (element instanceof HTMLInputElement) {
    if (kind === "checkbox") {
      element.checked = Boolean(value);
      return;
    }

    if (kind === "radio") {
      element.checked =
        String(value ?? "") === element.value;
      return;
    }
  }

  const rendered = value == null ? "" : String(value);
  if (element.value !== rendered) {
    element.value = rendered;
  }
}

function collectNativeChecks(
  element: NativeFieldElement,
  kind: ElementKind,
): Check<unknown>[] {
  const nativeChecks: Check<unknown>[] = [];

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.required) {
      nativeChecks.push(
        kind === "checkbox"
          ? checks.requiredTrue
          : checks.required,
      );
    }

    if (
      element.minLength >= 0 &&
      element.hasAttribute("minlength")
    ) {
      nativeChecks.push(checks.minLength(element.minLength));
    }

    if (
      element.maxLength >= 0 &&
      element.hasAttribute("maxlength")
    ) {
      nativeChecks.push(checks.maxLength(element.maxLength));
    }
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === "email") {
      nativeChecks.push(checks.email);
    }

    if (element.pattern) {
      nativeChecks.push(checks.pattern(element.pattern));
    }

    if (kind === "number" && element.min !== "") {
      const minimum = Number(element.min);
      if (Number.isFinite(minimum)) {
        nativeChecks.push(checks.min(minimum));
      }
    }

    if (kind === "number" && element.max !== "") {
      const maximum = Number(element.max);
      if (Number.isFinite(maximum)) {
        nativeChecks.push(checks.max(maximum));
      }
    }
  }

  return nativeChecks;
}
