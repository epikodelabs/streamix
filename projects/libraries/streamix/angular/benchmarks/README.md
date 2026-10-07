# Streamix Angular renderer benchmarks

The benchmark suite runs in a real browser and is deliberately claim-free.

The browser runner currently executes:

- `raw-dom/text.data`
- `sx/compiled-text`
- `sx/coalesced-100-writes`
- `sx/keyed-reorder-N`

The cases are browser modules, so a browser is the only place they run. One
command does the whole thing — starts Vite, drives the installed Chrome
headlessly, prints the table, and shuts everything down:

```bash
npm run bench:angular
```

For the interactive page, where workloads tune via URL parameters and the
results also land in the browser console:

```bash
npm run bench:angular:serve
```

Open the printed URL. `browser-runner.ts` prints a console table and writes the
complete JSON result to the page and to `window.__SX_BENCHMARK_RESULTS__`.

```text
?samples=11&warmup=4&scalar=100000&coalesced=10000&rows=1000&reorders=1000
```

The headless runner reads the results out of the page after the load event, so
a case has to finish synchronously — `runBenchmark` does. Serve it through the
script, not a hand-typed `vite` path: Vite accepts a wrong `--root` without
checking it exists, then answers every request with 404.

Comparative adapters belong behind the workload contract in
`external-adapter.ts`. Only compare implementations when they render identical
DOM, perform the same source mutations, use production builds, run in the same
browser/process, and include equivalent setup/destruction work.
