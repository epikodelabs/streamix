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
  subscribe: (handlers: { complete?: () => void; error?: (err: any) => void }) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handlers = {
      complete: () => resolve(),
      error: (err: any) => { reject(err); handlers.complete!(); }, // Now handlers is in scope
    };
    
    subscribe(handlers);
  }).finally(async () => {
    // ensure all scheduled microtasks complete
    await scheduler.flush();
  });
}

// ---------------------------------------------------------------------------
// Test tracer (filtered/collapsed are NOT "dropped"; only errors are "dropped")
// ---------------------------------------------------------------------------

export class TestTracer extends ValueTracer {
  emitted: ValueTrace[] = [];
  delivered: ValueTrace[] = [];
  filtered: ValueTrace[] = [];
  collapsed: ValueTrace[] = [];
  dropped: ValueTrace[] = []; // Only errors

  constructor() {
    super({
      onValueEmitted: (t) => this.emitted.push(t),
      onValueDelivered: (t) => this.delivered.push(t),
      onValueFiltered: (t) => this.filtered.push(t),
      onValueCollapsed: (t) => this.collapsed.push(t),
      onValueDropped: (t) => this.dropped.push(t), // Only errors
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
// Tests
// ---------------------------------------------------------------------------

describe("Streamix Tracing – basic flow", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

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
    expect(tracer.filtered.length).toBe(0);
    expect(tracer.collapsed.length).toBe(0);
    expect(tracer.dropped.length).toBe(0);

    const trace = tracer.delivered[0];
    expect(trace.operatorSteps.length).toBe(1);
    expect(trace.operatorSteps[0].operatorName).toContain("map");
    expect(trace.operatorSteps[0].outcome).toBe("transformed");
  });
});

// ---------------------------------------------------------------------------

describe("Streamix Tracing – filtering", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  it("marks filtered values correctly (not as dropped)", async () => {
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
    expect(tracer.emitted.length).toBe(3);
    expect(tracer.delivered.length).toBe(2);
    expect(tracer.filtered.length).toBe(1);
    expect(tracer.collapsed.length).toBe(0);
    expect(tracer.dropped.length).toBe(0); // Filtered values are NOT dropped

    const filteredTrace = tracer.filtered[0];
    expect(filteredTrace.state).toBe("filtered");
    expect(filteredTrace.sourceValue).toBe(1);
    expect(filteredTrace.droppedReason?.reason).toBe("filtered");
  });

  it("tracks multiple filters in a chain", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
      yield 5;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(
          filter((x) => x > 1), // filters 1
          filter((x) => x < 5) // filters 5
        )
        .subscribe({
          next: (v) => received.push(v),
          complete,
        });
    });

    expect(received).toEqual([2, 3, 4]);
    expect(tracer.emitted.length).toBe(5);
    expect(tracer.delivered.length).toBe(3);
    expect(tracer.filtered.length).toBe(2);
    expect(tracer.dropped.length).toBe(0);

    // Value 1 filtered by first filter
    const filtered1 = tracer.filtered.find((t) => t.sourceValue === 1);
    expect(filtered1?.operatorSteps.length).toBe(1);
    expect(filtered1?.operatorSteps[0].operatorName).toContain("filter");

    // Value 5 passes first filter, filtered by second
    const filtered5 = tracer.filtered.find((t) => t.sourceValue === 5);
    expect(filtered5?.operatorSteps.length).toBe(2);
    expect(filtered5?.operatorSteps[1].operatorName).toContain("filter");
  });
});

// ---------------------------------------------------------------------------

describe("Streamix Tracing – operator chain", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  it("tracks each operator step in order", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 2;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(
          map((x) => x + 1), // 2 → 3
          map((x) => x * 10), // 3 → 30
          filter((x) => x > 20) // pass
        )
        .subscribe({
          next: (v) => received.push(v),
          complete,
        });
    });

    expect(received).toEqual([30]);
    expect(tracer.delivered.length).toBe(1);

    const trace = tracer.delivered[0];
    expect(trace.operatorSteps.length).toBe(3);

    expect(trace.operatorSteps[0].outputValue).toBe(3);
    expect(trace.operatorSteps[0].outcome).toBe("transformed");

    expect(trace.operatorSteps[1].outputValue).toBe(30);
    expect(trace.operatorSteps[1].outcome).toBe("transformed");

    expect(trace.operatorSteps[2].operatorName).toContain("filter");
    expect(trace.operatorSteps[2].outcome).toBe("transformed");
  });
});

// ---------------------------------------------------------------------------

describe("Streamix Tracing - expanded operators", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  it("traces mergeMap expansions correctly", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(mergeMap((value) => [value, value + 10])).subscribe({
        next: (value) => received.push(value),
        complete,
      });
    });

    expect(received).toEqual([1, 11]);
    expect(tracer.emitted.length).toBe(1); // Only 1 original emission
    expect(tracer.delivered.length).toBe(2); // But 2 delivered values

    // First value (1) should be transformed
    const firstTrace = tracer.delivered.find((t) => t.finalValue === 1);
    expect(firstTrace?.operatorSteps[0].outcome).toBe("transformed");

    // Second value (11) should be expanded
    const secondTrace = tracer.delivered.find((t) => t.finalValue === 11);
    expect(secondTrace?.operatorSteps[0].outcome).toBe("expanded");
  });

  it("handles multiple expansions", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(mergeMap((value) => [value, value + 10, value + 20])).subscribe(
        {
          next: (value) => received.push(value),
          complete,
        }
      );
    });

    expect(received).toEqual([1, 11, 21, 2, 12, 22]);
    expect(tracer.emitted.length).toBe(2);
    expect(tracer.delivered.length).toBe(6);

    // Count expanded outcomes
    const expandedCount = tracer.delivered.filter(
      (t) => t.operatorSteps[0]?.outcome === "expanded"
    ).length;

    expect(expandedCount).toBe(4); // 2 expansions per input (1st is transformed)
  });
});

// ---------------------------------------------------------------------------

describe("Streamix Tracing - collapsing operators", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  it("tracks buffered arrays correctly (collapsed, not filtered)", async () => {
    const received: number[][] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(buffer(50)).subscribe({
        next: (value) => received.push(value),
        complete,
      });
    });

    expect(received).toEqual([[1, 2, 3]]);
    expect(tracer.emitted.length).toBe(3);
    expect(tracer.delivered.length).toBe(1);
    expect(tracer.filtered.length).toBe(0); // NOT filtered
    expect(tracer.collapsed.length).toBe(2); // 2 values collapsed into the array
    expect(tracer.dropped.length).toBe(0); // NOT dropped (errors only)

    // First value becomes the output "carrier"
    const delivered = tracer.delivered[0];
    expect(delivered.sourceValue).toBe(1);
    expect(delivered.finalValue).toEqual([1, 2, 3]);

    // ✅ With polished semantics: buffer is a collapsing operator, so the producing
    // value's operator step should be marked as "collapsed" (many inputs → one output)
    expect(delivered.operatorSteps[0].outcome).toBe("collapsed");

    // Other values are collapsed
    const collapsed = tracer.collapsed;
    expect(collapsed.length).toBe(2);
    expect(collapsed[0].sourceValue).toBe(2);
    expect(collapsed[0].state).toBe("collapsed");
    expect(collapsed[0].droppedReason?.reason).toBe("collapsed");
    expect(collapsed[1].sourceValue).toBe(3);
    expect(collapsed[1].state).toBe("collapsed");
    expect(collapsed[1].droppedReason?.reason).toBe("collapsed");
  });

  it("distinguishes between filtered and collapsed", async () => {
    const received: number[][] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(
          filter((x) => x > 1), // filters out 1
          buffer(50) // collapses 2, 3, 4 into [2,3,4]
        )
        .subscribe({
          next: (value) => received.push(value),
          complete,
        });
    });

    expect(received).toEqual([[2, 3, 4]]);
    expect(tracer.emitted.length).toBe(4);
    expect(tracer.delivered.length).toBe(1);
    expect(tracer.filtered.length).toBe(1); // Value 1 filtered
    expect(tracer.collapsed.length).toBe(2); // Values 3, 4 collapsed (2 is carrier)
    expect(tracer.dropped.length).toBe(0);

    // Value 1 was filtered by filter operator
    expect(tracer.filtered[0].sourceValue).toBe(1);
    expect(tracer.filtered[0].droppedReason?.reason).toBe("filtered");

    // Delivered value is the carrier (2) and should show collapse outcome on buffer step
    const delivered = tracer.delivered[0];
    expect(delivered.sourceValue).toBe(2);
    expect(delivered.finalValue).toEqual([2, 3, 4]);
    expect(delivered.operatorSteps.at(-1)?.operatorName).toContain("buffer");
    expect(delivered.operatorSteps.at(-1)?.outcome).toBe("collapsed");

    // Values 3, 4 were collapsed by buffer operator
    expect(tracer.collapsed[0].sourceValue).toBe(3);
    expect(tracer.collapsed[0].droppedReason?.reason).toBe("collapsed");
    expect(tracer.collapsed[1].sourceValue).toBe(4);
    expect(tracer.collapsed[1].droppedReason?.reason).toBe("collapsed");
  });
});

// ---------------------------------------------------------------------------

describe("Streamix Tracing - operator error", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  it("marks errored values as dropped (not filtered or collapsed)", async () => {
    const boom = createOperator<number, number>("boom", (source) => ({
      async next() {
        const r = await source.next();
        if (r.done) return r;
        throw new Error("BOOM");
      },
      return: source.return?.bind(source),
      throw: source.throw?.bind(source),
    }));

    const stream = createStream("numbers", async function* () {
      yield 1;
    });

    let errorCaught = false;

    await waitForCompletion(({ error }) => {
      stream.pipe(boom).subscribe({
        error: (err) => {
          errorCaught = true;
          error?.(err);
        },
      });
    });

    expect(errorCaught).toBe(true);
    expect(tracer.emitted.length).toBe(1);
    expect(tracer.filtered.length).toBe(0); // NOT filtered
    expect(tracer.collapsed.length).toBe(0); // NOT collapsed
    expect(tracer.dropped.length).toBe(1); // IS dropped (error)

    const dropped = tracer.dropped[0];
    expect(dropped.state).toBe("errored");
    expect(dropped.droppedReason?.reason).toBe("errored");
    expect(dropped.droppedReason?.error?.message).toBe("BOOM");
  });

  it("errors don't appear in filtered or collapsed arrays", async () => {
    const boom = createOperator<number, number>("boom", (source) => ({
      async next() {
        const r = await source.next();
        if (r.done) return r;
        throw new Error("BOOM");
      },
      return: source.return?.bind(source),
      throw: source.throw?.bind(source),
    }));

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
    });

    await waitForCompletion(({ error }) => {
      stream.pipe(boom).subscribe({ error: (err) => error?.(err) });
    });

    expect(tracer.filtered.length).toBe(0);
    expect(tracer.collapsed.length).toBe(0);
    expect(tracer.dropped.length).toBe(1); // Only first value before error
  });
});

// ---------------------------------------------------------------------------

describe("Streamix Tracing – stats", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    tracer.clear();
  });

  it("calculates accurate stats", async () => {
    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
      yield 4;
      yield 5;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(
          filter((x) => x > 1), // filters 1
          buffer(50) // collapses 2..5 into one
        )
        .subscribe({
          next: () => {},
          complete,
        });
    });

    const stats = tracer.getStats();
    expect(stats.total).toBe(5);
    expect(stats.delivered).toBe(1); // [2, 3, 4, 5]
    expect(stats.filtered).toBe(1); // 1
    expect(stats.collapsed).toBe(3); // 3, 4, 5 (2 is carrier)
    expect(stats.errored).toBe(0);

    // Only errors count as "dropped"
    expect(stats.dropRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("Streamix Tracing – disabled", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    disableTracing();
  });

  afterEach(() => {
    tracer.clear();
  });

  it("does nothing when tracing is disabled", async () => {
    const stream = createStream("numbers", async function* () {
      yield 1;
    });

    const result = await stream.pipe(map((x) => x * 2)).query();

    expect(tracer.emitted.length).toBe(0);
    expect(tracer.delivered.length).toBe(0);
    expect(result).toBe(2);
  });
});
