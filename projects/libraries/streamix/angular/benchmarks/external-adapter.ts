import type {
  BenchmarkCase,
} from './benchmark-harness';

/**
 * Adapter boundary for comparative benchmarks.
 *
 * Keep framework-specific setup outside the sx package so every contender can
 * run the exact same workload without making the Streamix package depend on
 * Million.js, React, or Angular benchmark fixtures.
 */
export interface ExternalRendererAdapter {
  readonly scalarText: BenchmarkCase;
  keyedReorder(rowCount: number): BenchmarkCase;
}
