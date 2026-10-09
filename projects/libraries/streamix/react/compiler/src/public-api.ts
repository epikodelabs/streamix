/**
 * Build-time transform. Keep this separate from `@epikodelabs/streamix/react`
 * so browser bundles never load TypeScript's Node-oriented compiler runtime.
 */
export * from "./compiler";
