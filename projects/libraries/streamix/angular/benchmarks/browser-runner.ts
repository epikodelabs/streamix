import {
  runBenchmark,
  type BenchmarkOptions,
  type BenchmarkResult,
} from './benchmark-harness';
import {
  rawDomTextCase,
  sxCompiledTextCase,
} from './scalar-update.benchmark';
import {
  sxCoalescedCase,
} from './coalesced-update.benchmark';
import {
  keyedReorderCase,
} from './keyed-reorder.benchmark';

export interface BrowserBenchmarkRun {
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly results: readonly BenchmarkResult[];
}

function integerParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const parsed = Number(params.get(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function options(
  iterations: number,
  samples: number,
  warmup: number,
): BenchmarkOptions {
  return { iterations, samples, warmup };
}

export function runBrowserBenchmarks(
  search = globalThis.location?.search ?? '',
): BrowserBenchmarkRun {
  const params = new URLSearchParams(search);
  const samples = integerParam(params, 'samples', 9);
  const warmup = integerParam(params, 'warmup', 3);
  const scalarIterations = integerParam(params, 'scalar', 50_000);
  const coalescedIterations = integerParam(params, 'coalesced', 5_000);
  const rows = integerParam(params, 'rows', 1_000);
  const reorders = integerParam(params, 'reorders', 500);

  const results = [
    runBenchmark(rawDomTextCase, options(scalarIterations, samples, warmup)),
    runBenchmark(sxCompiledTextCase, options(scalarIterations, samples, warmup)),
    runBenchmark(sxCoalescedCase, options(coalescedIterations, samples, warmup)),
    runBenchmark(keyedReorderCase(rows), options(reorders, samples, warmup)),
  ];

  return {
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    results,
  };
}

function render(run: BrowserBenchmarkRun): void {
  console.table(run.results.map(result => ({
    case: result.name,
    iterations: result.iterations,
    medianMs: Number(result.medianMs.toFixed(3)),
    opsPerSecond: Math.round(result.opsPerSecond),
  })));

  const output = document.querySelector<HTMLPreElement>('#results');
  if (output) {
    output.textContent = JSON.stringify(run, null, 2);
  }

  (globalThis as typeof globalThis & {
    __SX_BENCHMARK_RESULTS__?: BrowserBenchmarkRun;
  }).__SX_BENCHMARK_RESULTS__ = run;
}

queueMicrotask(() => render(runBrowserBenchmarks()));
