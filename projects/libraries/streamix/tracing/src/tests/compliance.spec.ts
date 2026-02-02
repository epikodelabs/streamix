import {
  disableTracing,
  enableTracing,
  installTracingHooks,
  type ValueTracer,
} from "@epikodelabs/streamix/tracing";

import {
  audit,
  createStream,
  debounce,
  delay as delayOp,
  delayUntil,
  delayWhile,
  from,
  observeOn,
  sample,
  share,
  shareReplay,
  throttle,
  type Stream,
} from "@epikodelabs/streamix";

function createTestTracer() {
  const calls: any[] = [];

  const tracer: ValueTracer = {
    startTrace: (vId, sId, sName, subId, val) => {
      calls.push({ type: "startTrace", vId, sId, sName, subId, val });
      return {
        valueId: vId,
        streamId: sId,
        streamName: sName,
        subscriptionId: subId,
        emittedAt: Date.now(),
        state: "emitted",
        sourceValue: val,
        operatorSteps: [],
        operatorDurations: new Map(),
      };
    },
    createExpandedTrace: (baseId, opIdx, opName, val) => {
      const id = `expanded_${baseId}_${opIdx}_${calls.length}`;
      calls.push({ type: "createExpandedTrace", baseId, opIdx, opName, val, id });
      return id;
    },
    enterOperator: (vId, opIdx, opName, val) => calls.push({ type: "enterOperator", vId, opIdx, opName, val }),
    exitOperator: (vId, opIdx, val, filtered, outcome) => {
      calls.push({ type: "exitOperator", vId, opIdx, val, filtered, outcome });
      return vId;
    },
    collapseValue: (...args) => calls.push({ type: "collapseValue", args }),
    errorInOperator: (...args) => calls.push({ type: "errorInOperator", args }),
    markDelivered: (vId) => calls.push({ type: "markDelivered", vId }),
    completeSubscription: (subId) => calls.push({ type: "completeSubscription", subId }),
  };

  return { tracer, calls };
}

async function toArray<T>(stream: Stream<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of stream as any) out.push(v);
  return out;
}

function idsOf(calls: any[], type: string): string[] {
  return calls.filter((c) => c.type === type).map((c) => c.vId);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function expectAllStartedWereDelivered(calls: any[], expectedDeliveries: number) {
  const started = idsOf(calls, "startTrace");
  const delivered = idsOf(calls, "markDelivered");

  expect(delivered.length).toBe(expectedDeliveries);
  expect(unique(delivered).length).toBe(expectedDeliveries);

  // For these tests we pick pipelines where every input should reach the sink.
  // If tracing correlation breaks, we typically see duplicate deliveries and orphan start traces.
  expect(unique(started)).toEqual(unique(delivered));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}


installTracingHooks();

describe("tracingCompliance", () => {
  afterEach(() => disableTracing());

  it("share preserves distinct valueIds for duplicate primitive values", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const stream = from([1, 1]).pipe(share());

    // Let the internal connect loop run and push into the subject.
    await delay(0);

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("shareReplay preserves distinct valueIds for duplicate primitive values", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const stream = from([1, 1]).pipe(shareReplay(2));

    // Let the internal connect loop run and populate the replay buffer.
    await delay(0);

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("delayUntil preserves distinct valueIds for buffered duplicate values", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    // Important: delayUntil discards buffered values if the source completes
    // before the notifier emits. Keep the source alive long enough for gating.
    const notifier = delay(10).then(() => true);
    const source = createStream<number>("delayUntil_source", async function* () {
      yield 1;
      yield 1;
      await delay(50);
    });

    const stream = source.pipe(delayUntil(notifier));

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("delayWhile preserves distinct valueIds when flushing buffered duplicates", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    // Delay the first value, then emit the second, then flush the queue.
    const stream = from([1, 1]).pipe(delayWhile((_v, idx) => idx === 0));

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("delay preserves distinct valueIds for duplicate primitives", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const source = createStream<number>("delay_source", async function* () {
      yield 1;
      await delay(5);
      yield 1;
      await delay(5);
    });

    const stream = source.pipe(delayOp(5));

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("observeOn preserves distinct valueIds for duplicate primitives", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const source = createStream<number>("observeOn_source", async function* () {
      yield 1;
      await delay(5);
      yield 1;
      await delay(5);
    });

    const stream = source.pipe(observeOn("macrotask"));

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("debounce preserves distinct valueIds for duplicate primitives across windows", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const source = createStream<number>("debounce_source", async function* () {
      yield 1;
      await delay(30);
      yield 1;
      await delay(30);
    });

    const stream = source.pipe(debounce(10));

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("audit preserves distinct valueIds for duplicate primitives across windows", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const source = createStream<number>("audit_source", async function* () {
      yield 1;
      await delay(30);
      yield 1;
      await delay(30);
    });

    const stream = source.pipe(audit(10));

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("throttle preserves distinct valueIds for duplicate primitives with trailing emission", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const source = createStream<number>("throttle_source", async function* () {
      yield 1;
      await delay(1);
      yield 1;
      await delay(5);
    });

    const stream = source.pipe(throttle(25));

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });

  it("sample preserves distinct valueIds for duplicate primitives across ticks", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const source = createStream<number>("sample_source", async function* () {
      yield 1;
      // Ensure at least one sampling tick happens before the next value.
      await delay(25);
      yield 1;
      await delay(5);
    });

    const stream = source.pipe(sample(10));

    const out = await toArray(stream);
    expect(out).toEqual([1, 1]);

    expectAllStartedWereDelivered(calls, 2);
  });
});
