// Avoid a hard dependency on Node ambient types in browser-focused specs.
const processLike = (globalThis as { process?: { versions?: { node?: unknown } } }).process;

const isNode =
  processLike != null &&
  processLike.versions != null &&
  processLike.versions.node != null;

const isBrowser =
  typeof window !== "undefined" &&
  typeof window.document !== "undefined";

// Suite-level wrappers (describe only accepts sync functions)
/**
 * Function ndescribe.
 */
export function ndescribe(name: string, fn: () => void) {
  return isNode ? describe(name, fn) : xdescribe(name, fn);
}

/**
 * Function idescribe.
 */
export function idescribe(name: string, fn: () => void) {
  return isBrowser ? describe(name, fn) : xdescribe(name, fn);
}

// Spec-level wrappers (it allows async callbacks with DoneFn)
/**
 * Function nit.
 */
export function nit(name: string, fn: jasmine.ImplementationCallback) {
  return isNode ? it(name, fn) : xit(name, fn);
}

/**
 * Function iit.
 */
export function iit(name: string, fn: jasmine.ImplementationCallback) {
  return isBrowser ? it(name, fn) : xit(name, fn);
}

// Export environment flags too
export { isBrowser, isNode };

