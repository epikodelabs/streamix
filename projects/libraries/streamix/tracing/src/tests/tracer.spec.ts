import {
  buffer,
  createOperator,
  createStream,
  filter,
  map,
  mergeMap,
  scheduler
} from "@epikodelabs/streamix";

import {
  createTerminalTracer,
  createValueTracer,
  disableTracing,
  enableTracing,
  generateValueId,
  getGlobalTracer,
  getValueId,
  isTracedValue,
  unwrapTracedValue,
  ValueTracer,
  wrapTracedValue,
  type ValueTrace,
} from "@epikodelabs/streamix/tracing";

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

async function waitForCompletion(
  subscribe: (handlers: { complete?: () => void; error?: (err: any) => void }) => void,
  options?: { allowError?: boolean }
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    subscribe({
      complete: resolve,
      error: (err) => (options?.allowError ? resolve() : reject(err)),
    });
  }).finally(async () => {
    await scheduler.flush();
  });
}

// ---------------------------------------------------------------------------
// Test tracer
// ---------------------------------------------------------------------------

type TestTracer = ReturnType<typeof createTestTracer>;

function createTestTracer() {
  const emitted: ValueTrace[] = [];
  const delivered: ValueTrace[] = [];
  const filtered: ValueTrace[] = [];
  const collapsed: ValueTrace[] = [];
  const dropped: ValueTrace[] = [];
  const emittedIds = new Set<string>();
  const deliveredIds = new Set<string>();
  const filteredIds = new Set<string>();
  const collapsedIds = new Set<string>();
  const droppedIds = new Set<string>();

  const tracer = createValueTracer({
    onTraceUpdate: (t) => {
      if (t.state === "emitted" && !emittedIds.has(t.valueId)) {
        emittedIds.add(t.valueId);
        emitted.push(t);
      }
    },
  });

  const addUnique = (list: ValueTrace[], seen: Set<string>, trace: ValueTrace) => {
    if (seen.has(trace.valueId)) return;
    seen.add(trace.valueId);
    list.push(trace);
  };

  tracer.subscribe({
    delivered: (t) => addUnique(delivered, deliveredIds, t),
    filtered: (t) => addUnique(filtered, filteredIds, t),
    collapsed: (t) => addUnique(collapsed, collapsedIds, t),
    dropped: (t) => addUnique(dropped, droppedIds, t),
  });

  const baseClear = tracer.clear;

  return Object.assign(tracer, {
    emitted,
    delivered,
    filtered,
    collapsed,
    dropped,
    clear() {
      emitted.length = 0;
      delivered.length = 0;
      filtered.length = 0;
      collapsed.length = 0;
      dropped.length = 0;
      emittedIds.clear();
      deliveredIds.clear();
      filteredIds.clear();
      collapsedIds.clear();
      droppedIds.clear();
      baseClear();
    },
  });
}

function createTerminalTestTracer() {
  const emitted: ValueTrace[] = [];
  const delivered: ValueTrace[] = [];
  const filtered: ValueTrace[] = [];
  const collapsed: ValueTrace[] = [];
  const dropped: ValueTrace[] = [];
  const emittedIds = new Set<string>();
  const deliveredIds = new Set<string>();
  const filteredIds = new Set<string>();
  const collapsedIds = new Set<string>();
  const droppedIds = new Set<string>();

  const tracer = createTerminalTracer({
    onTraceUpdate: (t) => {
      if (t.state === "emitted" && !emittedIds.has(t.valueId)) {
        emittedIds.add(t.valueId);
        emitted.push(t);
      }
    },
  });

  const addUnique = (list: ValueTrace[], seen: Set<string>, trace: ValueTrace) => {
    if (seen.has(trace.valueId)) return;
    seen.add(trace.valueId);
    list.push(trace);
  };

  tracer.subscribe({
    delivered: (t) => addUnique(delivered, deliveredIds, t),
    filtered: (t) => addUnique(filtered, filteredIds, t),
    collapsed: (t) => addUnique(collapsed, collapsedIds, t),
    dropped: (t) => addUnique(dropped, droppedIds, t),
  });

  const baseClear = tracer.clear;

  return Object.assign(tracer, {
    emitted,
    delivered,
    filtered,
    collapsed,
    dropped,
    clear() {
      emitted.length = 0;
      delivered.length = 0;
      filtered.length = 0;
      collapsed.length = 0;
      dropped.length = 0;
      emittedIds.clear();
      deliveredIds.clear();
      filteredIds.clear();
      collapsedIds.clear();
      droppedIds.clear();
      baseClear();
    },
  });
}

// ---------------------------------------------------------------------------
// FLATTENED TESTS
// ---------------------------------------------------------------------------

describe("valueTracer", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = createTestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  // ---------------------------------------------------------------------------
  // Basic flow
  // ---------------------------------------------------------------------------

  it("tracks emitted, transformed, delivered values", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(map((x) => x * 2)).subscribe({
        next: (v) => received.push(v),
        complete,
      });
    });

    expect(received).toEqual([2, 4, 6]);
    expect(tracer.emitted.length).toBe(3);
    expect(tracer.delivered.length).toBe(3);

    const trace = tracer.delivered[0];
    expect(trace.operatorSteps.length).toBe(1);
    expect(trace.operatorSteps[0].operatorName).toContain("map");
    expect(trace.operatorSteps[0].outcome).toBe("transformed");
  });

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  it("marks filtered values correctly (not dropped)", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(filter((x) => x > 1)).subscribe({
        next: (v) => received.push(v),
        complete,
      });
    });

    expect(received).toEqual([2, 3]);
    expect(tracer.filtered.length).toBe(1);
    expect(tracer.filtered[0].sourceValue).toBe(1);
    expect(tracer.filtered[0].droppedReason?.reason).toBe("filtered");
  });

  it("tracks multiple filters in a chain", async () => {
    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
      yield 5;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(filter((x) => x > 1), filter((x) => x < 5))
        .subscribe({ complete });
    });

    expect(tracer.filtered.length).toBe(2);
    expect(tracer.filtered.find((t) => t.sourceValue === 1)).toBeDefined();
    expect(tracer.filtered.find((t) => t.sourceValue === 5)).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Operator chain
  // ---------------------------------------------------------------------------

  it("tracks operator steps in correct order", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 2;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(
          map((x) => x + 1),
          map((x) => x * 10),
          filter((x) => x > 20)
        )
        .subscribe({
          next: (v) => received.push(v),
          complete,
        });
    });

    expect(received).toEqual([30]);
    expect(tracer.delivered[0].operatorSteps.length).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Expansion (mergeMap)
  // ---------------------------------------------------------------------------

  it("traces mergeMap expansions", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(mergeMap((v) => [v, v + 10])).subscribe({
        next: (v) => received.push(v),
        complete,
      });
    });

    expect(received).toEqual([1, 11]);
    expect(tracer.delivered.length).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Collapsing (buffer)
  // ---------------------------------------------------------------------------

  it("tracks collapsed values from buffer", async () => {
    const received: number[][] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(buffer(50)).subscribe({
        next: (v) => received.push(v),
        complete,
      });
    });

    expect(received).toEqual([[1, 2, 3]]);
    expect(tracer.emitted.length).toBe(3);
    expect(tracer.delivered.length).toBe(1);
    expect(tracer.collapsed.length).toBe(2);
    expect(tracer.collapsed.some((trace) => trace.sourceValue === 1)).toBeTrue();
    expect(tracer.collapsed.some((trace) => trace.sourceValue === 2)).toBeTrue();
  });

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------

  it("marks errored values as dropped", async () => {
    const boom = createOperator<number, number>("boom", (source) => ({
      async next() {
        const r = await source.next();
        if (r.done) return r;
        throw new Error("BOOM");
      },
    }));

    const stream = createStream("numbers", async function* () {
      yield 1;
    });

    await waitForCompletion(
      ({ error }) => {
        stream.pipe(boom).subscribe({ error });
      },
      { allowError: true }
    );

    expect(tracer.dropped.length).toBe(1);
    expect(tracer.dropped[0].droppedReason?.reason).toBe("errored");
  });

  it("marks in-flight values as dropped when stream completes early", async () => {
    const drainAndComplete = createOperator<number, number>(
      "drainAndComplete",
      (source) => ({
        async next() {
          const r = await source.next();
          if (r.done) return r;
          return { done: true, value: undefined } as IteratorResult<number>;
        },
      })
    );

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(drainAndComplete).subscribe({ complete });
    });

    expect(tracer.emitted.length).toBe(1);
    expect(tracer.delivered.length).toBe(0);
    expect(tracer.dropped.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  it("calculates correct tracing stats", async () => {
    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
      yield 5;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(filter((x) => x > 1), buffer(50)).subscribe({ complete });
    });

    const stats = tracer.getStats();
    expect(stats.total).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // Disabled
  // ---------------------------------------------------------------------------

  it("does nothing when tracing is disabled", async () => {
    disableTracing();

    const stream = createStream("numbers", async function* () {
      yield 1;
    });

    const result = await stream.pipe(map((x) => x * 2)).query();

    expect(result).toBe(2);
    expect(tracer.emitted.length).toBe(0);
    expect(tracer.delivered.length).toBe(0);
  });

  it("collapses queued source values when an operator consumes multiple inputs", async () => {
    const pairSum = createOperator<number, number>("pairSum", (source) => ({
      async next() {
        const first = await source.next();
        if (first.done) return first;
        const second = await source.next();
        if (second.done) {
          return first;
        }
        return { done: false, value: (first.value as number) + (second.value as number) };
      },
      return: source.return?.bind(source),
      throw: source.throw?.bind(source),
    }));

    const stream = createStream("pair-sum", async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
    });

    const emitted: number[] = [];

    await waitForCompletion(({ complete, error }) => {
      stream.pipe(pairSum).subscribe({
        next: (value) => emitted.push(value),
        complete,
        error,
      });
    });

    expect(emitted).toEqual([3, 7]);
    expect(tracer.collapsed.length).toBeGreaterThan(0);
    expect(tracer.collapsed.some((trace) => trace.sourceValue === 1)).toBeTrue();
  });

  it("wraps values into traced wrappers and exposes metadata helpers", () => {
    const meta = { valueId: "trace-1", streamId: "stream", subscriptionId: "sub" };
    const wrapped = wrapTracedValue(42, meta);
    expect(isTracedValue(wrapped)).toBeTrue();
    expect(unwrapTracedValue(wrapped)).toBe(42);
    expect(getValueId(wrapped)).toBe("trace-1");
  });

  it("notifies subscription observers when completion is triggered", () => {
    const completions: string[] = [];
    tracer.observeSubscription("sub-id", {
      complete: () => completions.push("done"),
    });

    tracer.completeSubscription("sub-id");
    expect(completions).toEqual(["done"]);
  });
});

describe("terminalTracer", () => {
  let tracer: ReturnType<typeof createTerminalTestTracer>;

  beforeEach(() => {
    tracer = createTerminalTestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  it("captures only terminal state without operator steps", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(map((x) => x * 2), filter((x) => x > 2))
        .subscribe({
          next: (v) => received.push(v),
          complete,
        });
    });

    expect(received).toEqual([4, 6]);
    expect(tracer.emitted.length).toBe(3);
    expect(tracer.delivered.length).toBe(2);
    expect(tracer.filtered.length).toBe(1);
    expect(tracer.delivered[0].operatorSteps.length).toBe(0);
    expect(tracer.filtered[0].operatorSteps.length).toBe(0);
  });
});

describe("tracerEdge", () => {
  it("trims oldest traces when exceeding maxTraces", () => {
    const tracer = createValueTracer({ maxTraces: 1 });

    tracer.startTrace("first", "stream", "stream-name", "sub", 1);
    tracer.startTrace("second", "stream", "stream-name", "sub", 2);

    const allTraces = tracer.getAllTraces();
    expect(allTraces.length).toBe(1);
    expect(allTraces[0].valueId).toBe("second");
    expect(tracer.getStats().total).toBe(1);
  });

  it("exitOperator returns null when no operator step exists", () => {
    const tracer = createValueTracer();
    tracer.startTrace("value-id", "stream", "name", "sub", 123);

    const result = tracer.exitOperator("value-id", 0, "output");
    expect(result).toBeNull();
  });

  it("createExpandedTrace works even if base trace is missing", () => {
    const tracer = createValueTracer();

    const expandedId = tracer.createExpandedTrace("missing-base", 1, "op-name", { foo: "bar" });
    const expandedTrace = tracer.getAllTraces().find((trace) => trace.valueId === expandedId);

    expect(expandedTrace).toBeDefined();
    expect(expandedTrace?.state).toBe("expanded");
    expect(expandedTrace?.streamId).toBe("unknown");
    expect(expandedTrace?.operatorSteps.length).toBe(1);
    expect(expandedTrace?.operatorSteps[0].operatorName).toBe("op-name");
  });

  it("collapseValue and errorInOperator tolerate missing traces", () => {
    const tracer = createValueTracer();
    expect(() => tracer.collapseValue("non-existent", 0, "op", "target")).not.toThrow();
    expect(() => tracer.errorInOperator("non-existent", 0, new Error("boom"))).not.toThrow();
  });

  it("exitOperator returns null when trace is absent", () => {
    const tracer = createTerminalTracer();
    expect(tracer.exitOperator("missing", 0, "value")).toBeNull();
  });
});

describe("tracerMismatch", () => {
  let tracer: ValueTracer;

  beforeEach(() => {
    tracer = createValueTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
  });

  it("records delivered traces for stream values", async () => {
    const values: number[] = [];

    const stream = createStream("wrapper-test", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });
    const tracedStream = stream.pipe();

    const completion = new Promise<void>((resolve) => {
      tracedStream.subscribe({
        next: (value) => values.push(value),
        complete: resolve,
      });
    });

    await scheduler.flush();
    await completion;

    expect(values).toEqual([1, 2, 3]);
    const traces = tracer.getAllTraces();
    expect(traces.length).toBe(values.length);
    traces.forEach((trace) => {
      expect(trace.state).toBe("delivered");
      expect(trace.deliveredAt).toBeDefined();
    });
  });

  it("handles operator transformations correctly", async () => {
    const transformedValues: number[] = [];

    const transformOperator = createOperator("transform", (source) => ({
      async next() {
        const result = await source.next();
        if (result.done) return result;
        return { done: false, value: (result.value as number) * 2 };
      },
      return: source.return?.bind(source),
      throw: source.throw?.bind(source),
    }));

    const stream = createStream("transform-test", async function* () {
      yield 1;
      yield 2;
    });

    const completion = new Promise<void>((resolve) => {
      stream.pipe(transformOperator).subscribe({
        next: (value) => transformedValues.push(value),
        complete: resolve,
      });
    });

    await scheduler.flush();
    await completion;

    expect(transformedValues).toEqual([2, 4]);

    const traces = tracer.getAllTraces();
    expect(traces.length).toBe(transformedValues.length);
    traces.forEach((trace) => {
      expect(trace.operatorSteps.length).toBeGreaterThan(0);
      expect(trace.operatorSteps[0].operatorName).toContain("transform");
    });
  });

  it("handles errors in streams without raising", async () => {
    const values: number[] = [];
    const errorTraces: ValueTrace[] = [];

    const unsubscribe = tracer.subscribe({
      dropped: (trace) => errorTraces.push(trace),
    });

    const stream = createStream("error-test", async function* () {
      yield 1;
      throw new Error("Test error");
    });
    const tracedStream = stream.pipe();

    let caughtError: Error | undefined;

    const completion = new Promise<void>((resolve) => {
      tracedStream.subscribe({
        next: (value) => values.push(value),
        error: (err) => {
          caughtError = err;
          resolve();
        },
        complete: () => resolve(),
      });
    });

    await scheduler.flush();
    await completion;
    unsubscribe();

    expect(values).toEqual([1]);
    expect(caughtError?.message).toBe("Test error");

    const traces = tracer.getAllTraces();
    expect(traces.length).toBe(values.length);
    traces.forEach((trace) => {
      expect(trace.sourceValue).toBe(1);
    });
  });

  it("profiles multi-subscription scenarios", async () => {
    const values1: number[] = [];
    const values2: number[] = [];

    const stream = createStream("multi-test", async function* () {
      yield 1;
      yield 2;
    });
    const tracedStream = stream.pipe();

    const completion1 = new Promise<void>((resolve) => {
      tracedStream.subscribe({
        next: (value) => values1.push(value),
        complete: resolve,
      });
    });

    const completion2 = new Promise<void>((resolve) => {
      tracedStream.subscribe({
        next: (value) => values2.push(value),
        complete: resolve,
      });
    });

    await scheduler.flush();
    await Promise.all([completion1, completion2]);

    expect(values1).toEqual([1, 2]);
    expect(values2).toEqual([1, 2]);

    const traces = tracer.getAllTraces();
    expect(traces.length).toBe(values1.length + values2.length);
  });
});
describe("tracerUtils", () => {
  afterEach(() => {
    disableTracing();
  });

  it("generates sequential value identifiers", () => {
    const firstId = parseInt(generateValueId().split("_")[1], 10);
    const secondId = parseInt(generateValueId().split("_")[1], 10);
    expect(secondId).toBe(firstId + 1);
  });

  it("exposes and clears the global tracer", () => {
    const tracer = createValueTracer();
    enableTracing(tracer);
    expect(getGlobalTracer()).toBe(tracer);

    disableTracing();
    expect(getGlobalTracer()).toBeNull();
  });
});
