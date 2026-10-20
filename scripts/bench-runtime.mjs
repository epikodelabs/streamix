/** Run with node scripts/bench-runtime.mjs. Median timings, not pass/fail thresholds. */
import { build } from 'esbuild';
const result = await build({
  stdin: { contents: `
import { internalRuntime, StreamixRuntime } from '../projects/libraries/streamix/src/lib/runtime/runtime';
import { setRuntimeInstrumentationEnabled } from '../projects/libraries/streamix/src/lib/runtime/diagnostics';
import { trackOperatorExecution } from '../projects/libraries/streamix/src/lib/runtime/operator-execution';
import { createAsyncCoordinator } from '../projects/libraries/streamix/src/lib/utils/coordinator';
const iterations = 100000;
async function sample(enabled, observed) {
  setRuntimeInstrumentationEnabled(enabled);
  const stop = observed ? internalRuntime.events.observe(() => {}) : () => {};
  const iterator = trackOperatorExecution({ next: async () => ({ done: false, value: 1 }), return: async () => ({ done: true, value: undefined }) });
  const start = performance.now();
  for (let i = 0; i < iterations; i++) await iterator.next();
  await iterator.return();
  stop();
  return performance.now() - start;
}
for (const [name, enabled, observed] of [['disabled', false, false], ['accounting', true, false], ['observed', true, true]]) {
  await sample(enabled, observed);
  const times = [];
  for (let i = 0; i < 7; i++) times.push(await sample(enabled, observed));
  times.sort((a, b) => a - b);
  console.log(name + ': ' + times[3].toFixed(2) + ' ms / ' + iterations + ' pulls (median of 7)');
}
const runtime = new StreamixRuntime(), source = {};
for (let i = 0; i < 1000; i++) {
  const dependent = {};
  runtime.dependencies(dependent, [source]);
  runtime.onInvalidate(dependent, () => {});
}
const times = [];
for (let run = 0; run < 8; run++) {
  const start = performance.now();
  for (let i = 0; i < 1000; i++) runtime.changed(source);
  if (run) times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log('graph propagation: ' + times[3].toFixed(2) + ' ms / 1,000,000 invalidations (median of 7)');

// Transport decoupling gate: coordinator source delivery is direct, no bus.
// A live coordinator must not observe the runtime bus, or production apps
// using sources would pay diagnostics eventing with no observer (rule 1).
// Delta-based, so listeners held elsewhere in this script don't false-positive.
const observedBefore = internalRuntime.events.observed;
const coordinator = createAsyncCoordinator([]);
if (internalRuntime.events.observed !== observedBefore) {
  throw new Error('transport regression: a live coordinator observes the diagnostics bus');
}
console.log('coordinator transport: direct delivery, runtime bus unobserved');
`, resolveDir: import.meta.dirname, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
