/**
 * Introspection entry. Importing any symbol from this entry evaluates the
 * implementation modules, and each of them installs itself into the core's
 * seams at module scope (bundlers may flatten re-export facades like this
 * file away, so the installs live with the code they install — see the
 * bottom of `introspection.ts` and `diagnostics.ts`). The core keeps inert
 * no-ops until then, so applications that never import this entry never
 * download or execute any of it. `enableStreamixIntrospection` (injected
 * into instrumented dev entries before application bootstrap) stays the arm
 * switch; installing merely makes arming possible.
 */
export * from './introspection';
export * from './inspector-panel';
export * from './diagnostics';
export * from './controls';
export { trackOperatorExecution } from './operator-execution';
