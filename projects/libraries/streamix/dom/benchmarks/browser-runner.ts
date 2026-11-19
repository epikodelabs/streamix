import {
  runFanOutMeasurement,
  type MeasurementParams,
  type MeasurementResult,
} from './intersection-fanout.benchmark';

export interface BenchmarkRun {
  readonly generatedAt: string;
  readonly userAgent: string;
  readonly params: MeasurementParams;
  readonly results: readonly MeasurementResult[];
}

function integerParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const parsed = Number(params.get(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function writeRun(run: BenchmarkRun | { error: string }): void {
  const output = document.getElementById('results');
  if (output) {
    output.textContent = JSON.stringify(run, null, 2);
  }

  // Release the load-event barrier so --dump-dom can read the results.
  void fetch('/benchmark-done');
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);

  const measurement: MeasurementParams = {
    targets: integerParam(params, 'targets', 250),
    batches: integerParam(params, 'batches', 60),
    nodesPerBatch: integerParam(params, 'nodesPerBatch', 25),
    samples: integerParam(params, 'samples', 5),
  };

  const results = await runFanOutMeasurement(measurement);
  const run: BenchmarkRun = {
    generatedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    params: measurement,
    results,
  };

  writeRun(run);
  console.table(
    results.map(result => ({
      case: result.name,
      medianMs: Number(result.medianMs.toFixed(3)),
      notes: result.notes,
    })),
  );
}

main().catch((error: unknown) => {
  writeRun({ error: String(error) });
});
