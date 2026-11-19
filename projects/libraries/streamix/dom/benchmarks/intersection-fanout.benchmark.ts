// `intersection` is not part of the dom barrel yet; measure the
// implementation module directly.
import { intersection } from "../src/lib/factories/intersection";

export interface MeasurementParams {
  /** Concurrent intersection sources subscribed during the fan-out scenario. */
  targets: number;
  /** Appended+removed batches per scenario sample (one childList mutation each). */
  batches: number;
  /** Elements appended and removed per batch. */
  nodesPerBatch: number;
  /** Samples per scenario; the median is reported. */
  samples: number;
}

export interface MeasurementResult {
  readonly name: string;
  readonly medianMs: number;
  readonly notes: string;
}

const macrotask = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Applies the mutation workload: per batch, append `nodesPerBatch` elements
 * to body and remove the previous batch. Every batch produces childList
 * records that every active body observer receives.
 */
async function applyMutationWorkload(
  batches: number,
  nodesPerBatch: number,
): Promise<void> {
  let previous: HTMLElement[] = [];

  for (let batch = 0; batch < batches; batch += 1) {
    const created: HTMLElement[] = [];

    for (let node = 0; node < nodesPerBatch; node += 1) {
      const element = document.createElement("div");
      element.textContent = `batch-${batch}-${node}`;
      created.push(element);
    }

    document.body.append(...created);

    for (const element of previous) {
      element.remove();
    }
    previous = created;

    // The browser notifies mutation observers in a microtask after this
    // task; a macrotask boundary lets the fan-out callbacks run per batch.
    await macrotask();
  }

  for (const element of previous) {
    element.remove();
  }
  await macrotask();
}

/**
 * Lets the initial synchronous heuristic settle and any queued observer work
 * drain. No rendering-frame waits: headless --dump-dom does not tick rAF.
 */
async function settleIntersectionSources(): Promise<void> {
  await macrotask();
  await new Promise(resolve => setTimeout(resolve, 16));
  await macrotask();
}

async function sampleScenario(
  targets: number,
  params: MeasurementParams,
): Promise<number> {
  const sources = [];

  for (let index = 0; index < targets; index += 1) {
    const element = document.createElement("span");
    // Parked off the viewport so IntersectionObserver stays quiet during the
    // measurement: only the MutationObserver fan-out is being timed.
    element.style.cssText =
      "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;";
    document.body.appendChild(element);
    sources.push({ element, subscription: intersection(element).subscribe() });
  }

  await settleIntersectionSources();

  const started = performance.now();
  await applyMutationWorkload(params.batches, params.nodesPerBatch);
  const elapsed = performance.now() - started;

  for (const { subscription, element } of sources) {
    subscription();
    element.remove();
  }
  await macrotask();

  return elapsed;
}

/**
 * One shared observer that performs a single connectivity check per batch,
 * the projected cost of a non-fan-out observation strategy.
 */
async function sampleSharedObserverScenario(
  params: MeasurementParams,
): Promise<number> {
  const observer = new MutationObserver(() => {
    // One representative connectivity check per notification.
    void document.body.childElementCount;
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const started = performance.now();
  await applyMutationWorkload(params.batches, params.nodesPerBatch);
  const elapsed = performance.now() - started;

  observer.disconnect();
  await macrotask();

  return elapsed;
}

/**
 * Direct cost of the connectivity check each fan-out callback performs,
 * `document.body.contains(el)` on an attached element.
 */
function measureContainsCost(calls: number): number {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const started = performance.now();
  for (let index = 0; index < calls; index += 1) {
    document.body.contains(element);
  }
  const elapsed = performance.now() - started;

  element.remove();
  return (elapsed / calls) * 1000;
}

export async function runFanOutMeasurement(
  params: MeasurementParams,
): Promise<readonly MeasurementResult[]> {
  // One warm-up pass per scenario loads the JIT before the sampled runs.
  await sampleScenario(1, { ...params, batches: 4 });
  await sampleSharedObserverScenario({ ...params, batches: 4 });

  const baselineSamples: number[] = [];
  const fanOutSamples: number[] = [];
  const sharedSamples: number[] = [];

  for (let index = 0; index < params.samples; index += 1) {
    baselineSamples.push(
      await sampleScenario(0, params),
    );
    fanOutSamples.push(
      await sampleScenario(params.targets, params),
    );
    sharedSamples.push(
      await sampleSharedObserverScenario(params),
    );
  }

  const baseline = median(baselineSamples);
  const fanOut = median(fanOutSamples);
  const shared = median(sharedSamples);
  const containsMicros = measureContainsCost(200_000);

  return [
    {
      name: "mutation workload alone",
      medianMs: baseline,
      notes: `${params.batches} batches x ${params.nodesPerBatch} nodes, no sources`,
    },
    {
      name: "fan-out through intersection sources",
      medianMs: fanOut,
      notes: `${params.targets} sources x ${params.batches} batches (each callback runs body.contains)`,
    },
    {
      name: "fan-out overhead per source per batch",
      medianMs: (fanOut - baseline) / (params.targets * params.batches) * 1000,
      notes: "microseconds, measured delta",
    },
    {
      name: "single shared observer projection",
      medianMs: shared,
      notes: "one observer, one connectivity check per batch",
    },
    {
      name: "document.body.contains",
      medianMs: containsMicros,
      notes: "microseconds per call on an attached element",
    },
  ];
}
