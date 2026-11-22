/**
 * Reads a compiler-approved local/property path without evaluating arbitrary
 * template JavaScript.
 *
 * @internal
 */
export function ɵsxReadLocal(
  context: Record<string, unknown>,
  path: string,
): unknown {
  const segments = path.split('.');
  let value: unknown = context;

  for (const segment of segments) {
    if (
      value == null ||
      (typeof value !== 'object' && typeof value !== 'function')
    ) {
      return undefined;
    }

    value = (value as Record<string, unknown>)[segment];
  }

  return value;
}

/** @internal */
export function ɵsxString(
  value: unknown,
): string {
  return value == null ? '' : String(value);
}

/** Resolves a generated path without relying on selector support during SSR. @internal */
export function ɵsxFindTarget(host: Element, markers: readonly string[]): Element {
  let parent = host;
  for (const marker of markers) {
    let match: Element | undefined;
    const children = parent.children;
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      if (child.getAttribute('data-sx-node') === marker) {
        match = child;
        break;
      }
    }
    if (!match) throw new Error(`Streamix could not locate DOM target "${marker}".`);
    parent = match;
  }
  return parent;
}
