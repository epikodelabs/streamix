# Streamix Angular renderer benchmarks

These benchmarks are deliberately claim-free.

Current local cases:

- `raw-dom/text.data`
- `sx/compiled-text`
- `sx/coalesced-100-writes`
- `sx/keyed-reorder-N`

The harness reports sample timings, median milliseconds, and operations per
second. It does not attempt to turn one microbenchmark into a marketing claim.

## Comparative adapters

`external-adapter.ts` defines the workload boundary for Angular Signals,
Million.js, or other renderers.

Comparative numbers should only be published when all implementations:

1. render the same final DOM;
2. perform the same number of source mutations;
3. use production builds;
4. run in the same browser/process;
5. use identical warmup/sample counts;
6. include creation/destruction consistently;
7. separate scalar-update and structural-reorder workloads.

Raw DOM is the useful lower-bound reference for the scalar path.
