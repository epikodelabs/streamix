import { type Field } from "@epikodelabs/streamix/forms";

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

export function defineField<T>(
  node: Field<T>,
  label: string,
  type: FieldInputType = "text",
  extras: Omit<FieldView<T>, "node" | "label" | "type"> = {},
): FieldView<T> {
  return { node, label, type, ...extras };
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
