/**
 * Compile-time query used by the sx template compiler to decide whether a
 * component property path is a Streamix DependencySource.
 *
 * A real Angular builder should answer this from the component TypeScript
 * type-checker. The template compiler deliberately does not duck-type runtime
 * values because that would make ordinary Angular objects change semantics.
 */
export type SxDependencySourceResolver = (path: string) => boolean;

/**
 * Creates a deterministic resolver from source paths discovered by an upstream
 * TypeScript-aware build adapter.
 */
export function createDependencySourcePathResolver(
  paths: Iterable<string>,
): SxDependencySourceResolver {
  const sources = new Set(paths);
  return path => sources.has(path);
}

/**
 * Returns true when `expression` is a plain component property path.
 */
export function isComponentPathExpression(expression: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(expression.trim());
}
