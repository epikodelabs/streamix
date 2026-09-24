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
