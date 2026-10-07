# Streamix Angular renderer benchmarks

The benchmark suite runs in a real browser and is deliberately claim-free.

The browser runner currently executes:

- `raw-dom/text.data`
- `sx/compiled-text`
- `sx/coalesced-100-writes`
- `sx/keyed-reorder-N`

Serve this directory through Vite from the repository root:

```bash
npm run bench:angular
```

Open the printed URL. `browser-runner.ts` prints a console table and writes the
complete JSON result to the page and to `window.__SX_BENCHMARK_RESULTS__`.

Run it from the repository root: Vite accepts a `--root` path without checking
that it exists, so a wrong path boots a server whose every request is a 404
("page is not available") and exits nowhere. The script pins the path for you.

Tune workloads with URL parameters:

```text
?samples=11&warmup=4&scalar=100000&coalesced=10000&rows=1000&reorders=1000
```

Comparative adapters belong behind the workload contract in
`external-adapter.ts`. Only compare implementations when they render identical
DOM, perform the same source mutations, use production builds, run in the same
browser/process, and include equivalent setup/destruction work.
