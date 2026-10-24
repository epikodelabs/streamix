/**
 * Interactive tour of the Streamix runtime introspection API.
 *
 * Run it with:
 *   node scripts/runtime-demo.mjs
 *
 * Bundles the library TypeScript sources in memory with esbuild (shipped with
 * vite) and executes the demo, printing what each introspection call returns.
 * Includes self-description: dev-only creation-site capture (file:line).
 */
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const demo = `
import { internalRuntime } from "../projects/libraries/streamix/src/lib/runtime/runtime";
import { setOriginCapture } from "../projects/libraries/streamix/src/lib/runtime/origin";
import { atom, derived, flow } from "../projects/libraries/streamix/src/lib/atoms/atom";
import { pipe } from "../projects/libraries/streamix/src/lib/atoms/pipe";
import { map } from "../projects/libraries/streamix/src/lib/operators/map";
import { from } from "../projects/libraries/streamix/src/lib/factories";

// Dev builds enable this automatically via import.meta.env.DEV; the demo
// runs from a plain bundle, so it opts in explicitly.
setOriginCapture(true);

const base = value => String(value).replace(/^.*[\\\\/]/, "");
const fmt = value => JSON.stringify(value, (_key, v) => typeof v === "function" ? "[fn]" : v);
const where = origin => origin ? base(origin.file) + ":" + origin.line + (origin.fn ? " (" + origin.fn + ")" : "") : "-";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

console.log("=== 1. inspect(): the whole runtime in one call ===");
const price = atom(10);
const quantity = atom(2);
const total = derived(() => price.value * quantity.value);
const label = derived(() => \`total = \${total.value}\`);
total.value; label.value;

const snapshot = internalRuntime.inspect();
console.log("graph:", fmt(snapshot.graph));
console.log("scheduler:", fmt(snapshot.scheduler));
console.log("nodes:");
for (const node of snapshot.nodes) {
  console.log(\`  depth=\${node.depth} deps=\${node.dependencies} dependents=\${node.dependents} origin=\${where(node.origin)}\`);
}

console.log("");
console.log("=== 2. inspect() inside a transaction: watch work queue up ===");
internalRuntime.scheduling.transaction(() => {
  price.set(20);
  const mid = internalRuntime.inspect();
  console.log("pending:", mid.scheduler.pending,
    "| queued depths:", mid.nodes.filter(n => n.queued).map(n => n.depth),
    "| transactionDepth:", mid.scheduler.transactionDepth);
});
console.log("after commit, pending:", internalRuntime.inspect().scheduler.pending, "| total:", total.value);

console.log("");
console.log("=== 3. describe(node): one flow's live execution record ===");
let release;
const live = flow(async function* () {
  yield 1;
  yield await new Promise(resolve => { release = value => resolve(value.value); });
});
const seen = [];
const unsubscribe = live.subscribe(value => seen.push(value));
for (let i = 0; i < 10 && seen.length === 0; i++) await tick();
console.log("while pending:", fmt({ ...internalRuntime.executions.describe(live), node: "[atom]" }));
console.log("global counters:", fmt(internalRuntime.inspect().executions));
release(2);
for (let i = 0; i < 10 && !live.disposed; i++) await tick();
console.log("after natural completion:", fmt(internalRuntime.executions.describe(live)));
console.log("(the record is released together with the atom)");
await unsubscribe();

console.log("");
console.log("=== 4. operator labels + origins ===");
const iterable = pipe(from([1, 2, 3]), map(v => v * 100));
let mapped = 0;
for await (const value of iterable) { void value; mapped++; }
await tick();
console.log("emitted:", mapped, "| totals:", fmt(internalRuntime.inspect().executions));

console.log("");
console.log("=== 5. live observation: graph events + execution events ===");
const stopGraph = internalRuntime.observe(event => console.log("  graph event:", event.kind, "(sequence", event.sequence + ")"));
const stopExecutions = internalRuntime.events.observe(event => console.log("  execution event:", event.kind, "gen", event.generation));
price.set(30);
stopGraph(); stopExecutions();
console.log("label now:", label.value);
console.log("");
console.log("done.");
`;

const workdir = await mkdtemp(join(tmpdir(), "streamix-demo-"));
const outfile = join(workdir, "demo.mjs");
try {
  await build({
    stdin: { contents: demo, resolveDir: import.meta.dirname, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(workdir, { recursive: true, force: true }).catch(() => {});
}
