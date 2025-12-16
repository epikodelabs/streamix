// test/utils/tracing.spec.ts

import "@actioncrew/streamix/tracing"; // ⬅️ registers runtime hooks (REQUIRED)

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
  subscribe: (handlers: { complete?: () => void; error?: () => void }) => void
): Promise<void> {
  return new Promise<void>((resolve) => {
    subscribe({
      complete: () => resolve(),
      error: () => resolve(), // error still ends the stream
    });
  }).finally(async () => {
    // ensure all scheduled microtasks complete
    await scheduler.flush();
  });
}

// ---------------------------------------------------------------------------
// Test tracer
// ---------------------------------------------------------------------------

export class TestTracer extends ValueTracer {
  emitted: ValueTrace[] = [];
  delivered: ValueTrace[] = [];
  filtered: ValueTrace[] = [];
  dropped: ValueTrace[] = [];

  constructor() {
    super({
      onValueEmitted: t => this.emitted.push(t),
      onValueDelivered: t => this.delivered.push(t),
      onValueFiltered: t => this.filtered.push(t),
      onValueDropped: t => this.dropped.push(t),
    });
  }

  override clear() {
    this.emitted.length = 0;
    this.delivered.length = 0;
    this.filtered.length = 0;
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
      stream.pipe(map(x => x * 2)).subscribe({
        next: v => received.push(v),
        complete,
      });
    });

    expect(received).toEqual([2, 4, 6]);
    expect(tracer.emitted.length).toBe(3);
    expect(tracer.delivered.length).toBe(3);

    const trace = tracer.delivered[0];
    expect(trace.operatorSteps.length).toBe(1);
    expect(trace.operatorSteps[0].operatorName).toContain("map");
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

  it("marks filtered values as dropped", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    await waitForCompletion(({ complete }) => {
      stream.pipe(filter(x => x > 1)).subscribe({
        next: v => received.push(v),
        complete,
      });
    });

    expect(received).toEqual([2, 3]);
    expect(tracer.emitted.length).toBe(3);
    expect(tracer.delivered.length).toBe(2);
    expect(tracer.filtered.length).toBe(1);
    expect(tracer.dropped.length).toBe(1);

    const filtered = tracer.filtered[0];
    expect(filtered.state).toBe("filtered");
    expect(filtered.sourceValue).toBe(1);
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
          map(x => x + 1),     // 2 → 3
          map(x => x * 10),    // 3 → 30
          filter(x => x > 20)  // pass
        )
        .subscribe({
          next: v => received.push(v),
          complete,
        });
    });

    expect(received).toEqual([30]);
    expect(tracer.delivered.length).toBe(1);

    const trace = tracer.delivered[0];
    expect(trace.operatorSteps.length).toBe(3);

    expect(trace.operatorSteps[0].outputValue).toBe(3);
    expect(trace.operatorSteps[1].outputValue).toBe(30);
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

  it("traces mergeMap expansions", async () => {
    const received: number[] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(mergeMap(value => [value, value + 10]))
        .subscribe({
          next: value => received.push(value),
          complete,
        });
    });

    expect(received).toEqual([1, 11]);
    expect(tracer.delivered.length).toBe(received.length);

    const steps = tracer.delivered.map(trace => trace.operatorSteps[0]);
    expect(steps.every(step => step?.operatorName.includes("mergeMap"))).toBeTrue();
    expect(steps.some(step => step?.outcome === "expanded")).toBeTrue();
  });

  it("tracks buffered arrays as traced values", async () => {
    const received: number[][] = [];

    const stream = createStream("numbers", async function* () {
      yield 1;
      yield 2;
    });

    await waitForCompletion(({ complete }) => {
      stream
        .pipe(buffer(50))
        .subscribe({
          next: value => received.push(value),
          complete,
        });
    });

    expect(received).toEqual([[1, 2]]);
    expect(tracer.delivered.length).toBe(1);

    const trace = tracer.delivered[0];
    expect(trace.operatorSteps.length).toBe(1);
    expect(trace.operatorSteps[0].operatorName).toContain("buffer");
    expect(trace.finalValue).toEqual([1, 2]);
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

  it("marks errored values as dropped", async () => {
    const boom = createOperator<number, number>("boom", source => ({
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
        error: () => {
          errorCaught = true;
          error?.();
        },
      });
    });

    expect(errorCaught).toBe(true);
    expect(tracer.dropped.length).toBe(1);

    const dropped = tracer.dropped[0];
    expect(dropped.state).toBe("errored");
    expect(dropped.droppedReason?.reason).toBe("errored");
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

    const result = await stream.pipe(map(x => x * 2)).query();

    expect(tracer.emitted.length).toBe(0);
    expect(tracer.delivered.length).toBe(0);
    expect(result).toBe(2);
  });
});
