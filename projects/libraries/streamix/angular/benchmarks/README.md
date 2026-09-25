# Streamix Angular renderer benchmarks

The benchmark suite runs in a real browser and is deliberately claim-free.

The browser runner currently executes:

- `raw-dom/text.data`
- `sx/compiled-text`
- `sx/coalesced-100-writes`
- `sx/keyed-reorder-N`

Serve this directory through Vite from a workspace where
`@epikodelabs/streamix` resolves normally:

```bash
npx vite ./angular/benchmarks
```

Open the printed URL. `browser-runner.ts` prints a console table and writes the
complete JSON result to the page and to `window.__SX_BENCHMARK_RESULTS__`.

Tune workloads with URL parameters:

```text
?samples=11&warmup=4&scalar=100000&coalesced=10000&rows=1000&reorders=1000
```

Comparative adapters belong behind the workload contract in
`external-adapter.ts`. Only compare implementations when they render identical
DOM, perform the same source mutations, use production builds, run in the same
browser/process, and include equivalent setup/destruction work.
