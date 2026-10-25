/**
 * One control surface for everything that observes the runtime: execution
 * accounting, per-node state readers, and creation-site capture. Internal by
 * rule 7 of DIAGNOSTICS.md — tests and tooling import it directly; it stays
 * behind internal imports and never enters the package API.
 */
import { setRuntimeInstrumentationEnabled, isRuntimeInstrumentationEnabled, setOriginCapture } from '@epikodelabs/streamix';
// The control surface implies the full introspection entry: toggles are
// meaningless without the implementations they gate.
import './introspection';

export const streamixDiagnostics = Object.freeze({
  /** Master switch: accounting plus origin capture together, the dev defaults. */
  setEnabled(next: boolean): void {
    setRuntimeInstrumentationEnabled(next);
    setOriginCapture(next);
  },
  /** True while execution accounting and node state capture are recorded. */
  get enabled(): boolean {
    return isRuntimeInstrumentationEnabled();
  },
  /** Fine-grained: execution accounting and per-node state readers only. */
  setAccounting: setRuntimeInstrumentationEnabled,
  /** Fine-grained: creation-site capture only. */
  setOriginCapture,
});

export type StreamixDiagnosticsControls = typeof streamixDiagnostics;
