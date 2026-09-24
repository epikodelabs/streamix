/**
 * Shared DOM write/equal closures.
 *
 * The directive path (`direct-binding.ts`) and the compiled path
 * (`binding-table.ts`) must stay byte-identical in behavior, so each writer
 * is defined exactly once here.
 *
 * @internal
 */

export function writeText(target: Node): (value: unknown) => void {
  return value => {
    target.textContent = value == null ? '' : String(value);
  };
}

export function equalText(previous: unknown, next: unknown): boolean {
  return (previous == null ? '' : String(previous)) ===
    (next == null ? '' : String(next));
}

export function writeProperty(
  target: object,
  property: string,
): (value: unknown) => void {
  return value => {
    (target as Record<string, unknown>)[property] = value;
  };
}

/**
 * null / undefined / false remove the attribute. `true` writes an empty
 * attribute; all other values are stringified.
 */
export function writeAttribute(
  target: Element,
  attribute: string,
): (value: unknown) => void {
  return value => {
    if (value == null || value === false) {
      target.removeAttribute(attribute);
      return;
    }

    target.setAttribute(attribute, value === true ? '' : String(value));
  };
}

export function writeClass(
  target: Element,
  className: string,
): (value: unknown) => void {
  return value => {
    target.classList.toggle(className, Boolean(value));
  };
}

export function equalClass(previous: unknown, next: unknown): boolean {
  return Boolean(previous) === Boolean(next);
}

/**
 * null / undefined / false remove the property. Other values are stringified.
 */
export function writeStyle(
  target: HTMLElement,
  property: string,
): (value: unknown) => void {
  return value => {
    if (value == null || value === false) {
      target.style.removeProperty(property);
      return;
    }

    target.style.setProperty(property, String(value));
  };
}
