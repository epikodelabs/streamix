export interface BenchmarkCase {
  readonly name: string;
  readonly setup: () => BenchmarkInstance;
}

export interface BenchmarkInstance {
  run(iterations: number): void;
  destroy(): void;
}

export interface BenchmarkResult {
  readonly name: string;
  readonly iterations: number;
  readonly samples: readonly number[];
  readonly medianMs: number;
  readonly opsPerSecond: number;
}

export interface BenchmarkOptions {
  readonly iterations: number;
  readonly samples?: number;
  readonly warmup?: number;
}

export function runBenchmark(
  benchmark: BenchmarkCase,
  options: BenchmarkOptions,
): BenchmarkResult {
  const samples = options.samples ?? 9;
  const warmup = options.warmup ?? 3;

  for (let index = 0; index < warmup; index += 1) {
    const instance = benchmark.setup();

    try {
      instance.run(options.iterations);
    } finally {
      instance.destroy();
    }
  }

  const timings: number[] = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const instance = benchmark.setup();

    const start = performance.now();

    try {
      instance.run(options.iterations);
    } finally {
      const end = performance.now();
      timings.push(end - start);
      instance.destroy();
    }
  }

  const ordered = [...timings].sort(
    (left, right) => left - right,
  );
  const medianMs = ordered[
    Math.floor(ordered.length / 2)
  ];

  return {
    name: benchmark.name,
    iterations: options.iterations,
    samples: timings,
    medianMs,
    opsPerSecond:
      medianMs === 0
        ? Number.POSITIVE_INFINITY
        : (options.iterations / medianMs) * 1000,
  };
}
