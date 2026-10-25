/**
 * The instrumentation flag is the single switch for execution accounting and
 * node state capture. It lives in the core — apart from the implementations
 * it gates — so `runtime.ts` can check it without importing any diagnostics
 * code. The implementations ride behind the introspection entry; when that
 * entry is never imported, the flag gates nothing at all.
 */

let instrumentationEnabled = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

/** Enable or disable execution accounting and node state capture. */
export function setRuntimeInstrumentationEnabled(next: boolean): void {
  instrumentationEnabled = next;
}

/** True while execution accounting and node state capture are recorded. */
export function isRuntimeInstrumentationEnabled(): boolean {
  return instrumentationEnabled;
}
