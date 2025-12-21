import "@actioncrew/streamix/tracing";

import {
  buffer,
  createOperator,
  createStream,
  filter,
  map,
  mergeMap,
  scheduler,
} from "@actioncrew/streamix";

import {
  disableTracing,
  enableTracing,
  ValueTrace,
  ValueTracer,
} from "@actioncrew/streamix/tracing";

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

class TestTracer extends ValueTracer {
  emitted: ValueTrace[] = [];
  delivered: ValueTrace[] = [];
  filtered: ValueTrace[] = [];
  collapsed: ValueTrace[] = [];
  dropped: ValueTrace[] = [];

  constructor() {
    super({
      onValueEmitted: (t) => this.emitted.push(t),
      onValueDelivered: (t) => this.delivered.push(t),
      onValueFiltered: (t) => this.filtered.push(t),
      onValueCollapsed: (t) => this.collapsed.push(t),
      onValueDropped: (t) => this.dropped.push(t),
    });
  }

  override clear() {
    this.emitted.length = 0;
    this.delivered.length = 0;
    this.filtered.length = 0;
    this.collapsed.length = 0;
    this.dropped.length = 0;
    super.clear();
  }
}

// ---------------------------------------------------------------------------
// FLATTENED TESTS
// ---------------------------------------------------------------------------

describe("Streamix tracing", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  // ─────────────────────────────────────────────────────────
  // Basic flow
  // ─────────────────────────────────────────────────────────

  it("tracks emitted → transformed → delivered values", async () => {
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

  // ─────────────────────────────────────────────────────────
  // Filtering
  // ─────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────
  // Operator chain
  // ─────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────
  // Expansion (mergeMap)
  // ─────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────
  // Collapsing (buffer)
  // ─────────────────────────────────────────────────────────

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
    expect(tracer.collapsed.length).toBe(2);
  });

  // ─────────────────────────────────────────────────────────
  // Errors
  // ─────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────
  // Stats
  // ─────────────────────────────────────────────────────────

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
    expect(stats.delivered).toBe(1);
    expect(stats.filtered).toBe(1);
    expect(stats.collapsed).toBe(3);
    expect(stats.errored).toBe(0);
  });

  // ─────────────────────────────────────────────────────────
  // Disabled
  // ─────────────────────────────────────────────────────────

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
});
