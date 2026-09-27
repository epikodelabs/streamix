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

/** Reactive class-map value accepted by `[sx.class]`. */
export type SxClassMap = Readonly<Record<string, unknown>>;

function assertClassToken(className: string): void {
  if (!className || /\s/.test(className)) {
    throw new Error(
      `Direct sx.class map key ${JSON.stringify(className)} must be one non-empty CSS class token.`,
    );
  }
}

/**
 * Writes a dynamic class map while retaining ownership only of class names
 * previously supplied by the map. Missing keys are removed on the next write;
 * unrelated static or Angular-owned classes are left untouched.
 */
export function writeClassMap(
  target: Element,
): (value: SxClassMap | null | undefined) => void {
  let owned = new Set<string>();

  return value => {
    const entries = Object.entries(value ?? {});

    for (const [className] of entries) {
      assertClassToken(className);
    }

    const next = new Set(entries.map(([className]) => className));

    for (const className of owned) {
      if (!next.has(className)) {
        target.classList.remove(className);
      }
    }

    for (const [className, current] of entries) {
      target.classList.toggle(className, Boolean(current));
    }

    owned = next;
  };
}

/** Reactive style-map value accepted by `[sx.style]`. */
export type SxStyleMap = Readonly<Record<string, unknown>>;

const SECURITY_SENSITIVE_STYLE_PROPERTIES = new Set([
  'background',
  'background-image',
  'clip-path',
  'cursor',
  'filter',
  'list-style',
  'list-style-image',
  'mask',
  'mask-image',
]);

/**
 * Converts DOM-style camelCase names to CSS property syntax while preserving
 * already-hyphenated names and CSS custom properties.
 */
export function normalizeStyleProperty(property: string): string {
  if (property.startsWith('--') || property.includes('-')) {
    return property;
  }

  return property.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

function assertSafeStyleProperty(property: string): void {
  if (SECURITY_SENSITIVE_STYLE_PROPERTIES.has(property.toLowerCase())) {
    throw new Error(
      `Direct sx.style property ${JSON.stringify(property)} may contain a URL-bearing CSS value and bypass Angular sanitization. Use an Angular-owned style binding for this property instead.`,
    );
  }
}

/**
 * null / undefined / false remove the property. Other values are stringified.
 * Both CSS (`transform-origin`) and DOM-style (`transformOrigin`) names work.
 */
export function writeStyle(
  target: HTMLElement,
  rawProperty: string,
): (value: unknown) => void {
  const property = normalizeStyleProperty(rawProperty);
  assertSafeStyleProperty(property);

  return value => {
    if (value == null || value === false) {
      target.style.removeProperty(property);
      return;
    }

    target.style.setProperty(property, String(value));
  };
}

/**
 * Writes a dynamic style map while retaining ownership only of keys previously
 * supplied by the map. Missing keys are removed on the next write; unrelated
 * inline styles are left untouched.
 *
 * Both CSS (`transform-origin`) and DOM-style (`transformOrigin`) property
 * names are accepted. CSS custom properties (`--token`) are preserved.
 */
export function writeStyleMap(
  target: HTMLElement,
): (value: SxStyleMap | null | undefined) => void {
  let owned = new Set<string>();

  return value => {
    const entries = Object.entries(value ?? {}).map(([rawProperty, current]) => {
      const property = normalizeStyleProperty(rawProperty);
      assertSafeStyleProperty(property);
      return [property, current] as const;
    });

    const next = new Set(entries.map(([property]) => property));

    for (const property of owned) {
      if (!next.has(property)) {
        target.style.removeProperty(property);
      }
    }

    for (const [property, current] of entries) {
      if (current == null || current === false) {
        target.style.removeProperty(property);
      } else {
        target.style.setProperty(property, String(current));
      }
    }

    owned = next;
  };
}
