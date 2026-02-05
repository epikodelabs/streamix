import {
  disableTracing,
  enableTracing,
  generateValueId,
  getGlobalTracer,
  getValueId,
  installTracingHooks,
  isTracedValue,
  uninstallTracingHooks,
  unwrapTracedValue,
  ValueTracer,
  wrapTracedValue
} from "@epikodelabs/streamix/tracing";

import { filter, from, map, mergeMap, reduce } from "@epikodelabs/streamix";

/* ========================================================================== */
/* TEST TRACER */
/* ========================================================================== */

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
    enterOperator: (vId, opIdx, opName, val) =>
      calls.push({ type: "enterOperator", vId, opIdx, opName, val }),
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

/* ========================================================================== */
/* SPECS */
/* ========================================================================== */

describe("tracingCore", () => {
  let { tracer } = createTestTracer();
  beforeEach(() => {
    installTracingHooks();
    enableTracing(tracer);
  });

  afterEach(() => {
    disableTracing();
    uninstallTracingHooks();
  });

  /* ------------------------------------------------------------------------ */
  /* UTILITIES */
  /* ------------------------------------------------------------------------ */

  it("wraps and unwraps traced values", () => {
    const wrapped = wrapTracedValue(42, {
      valueId: "v1",
      streamId: "s1",
      subscriptionId: "sub1",
    });

    expect(isTracedValue(wrapped)).toBeTrue();
    expect(getValueId(wrapped)).toBe("v1");
    expect(unwrapTracedValue(wrapped)).toBe(42);
  });

  it("passes through unwrapped values", () => {
    expect(isTracedValue(10)).toBeFalse();
    expect(unwrapTracedValue(10)).toBe(10);
    expect(getValueId(10)).toBeUndefined();
  });

  it("generates unique value ids", () => {
    const a = generateValueId();
    const b = generateValueId();
    expect(a).not.toBe(b);
  });

  /* ------------------------------------------------------------------------ */
  /* GLOBAL TRACER */
  /* ------------------------------------------------------------------------ */

  it("enables and disables global tracing", () => {
    const { tracer } = createTestTracer();

    enableTracing(tracer);
    expect(getGlobalTracer()).toBe(tracer);

    disableTracing();
    expect(getGlobalTracer()).toBeNull();
  });

  /* ------------------------------------------------------------------------ */
  /* RUNTIME INTEGRATION */
  /* ------------------------------------------------------------------------ */

  it("traces a simple map transformation", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const out: number[] = [];

    for await (const v of from([1]).pipe(map(x => x + 1))) {
      out.push(v);
    }

    expect(out).toEqual([2]);

    expect(calls.map(c => c.type)).toEqual([
      "startTrace",
      "enterOperator",
      "exitOperator",
      "markDelivered",
      "completeSubscription",
    ]);

    const exit = calls.find(c => c.type === "exitOperator");
    expect(exit.filtered).toBeFalse();
    expect(exit.outcome).toBe("transformed");
  });

  it("marks filtered values as terminal", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const out: number[] = [];

    for await (const v of from([1, 2]).pipe(filter(x => x > 1))) {
      out.push(v);
    }

    expect(out).toEqual([2]);

    const filtered = calls.find(c => c.type === "exitOperator" && c.filtered === true);
    expect(filtered).toBeDefined();
  });

  it("creates expanded traces for 1 → many operators", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const out: number[] = [];

    for await (const v of from([1]).pipe(mergeMap(x => [x, x + 1]))) {
      out.push(v);
    }

    expect(out).toEqual([1, 2]);

    const expanded = calls.filter(c => c.type === "createExpandedTrace");
    expect(expanded.length).toBe(1);

    const exit = calls.find(c => c.type === "exitOperator" && c.outcome === "expanded");
    expect(exit).toBeDefined();
  });

  it("collapses many → one operators", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const out: number[] = [];

    for await (const v of from([1, 2]).pipe(reduce((a, b) => a + b, 0))) {
      out.push(v);
    }

    expect(out).toEqual([3]);

    const collapse = calls.find(c => c.type === "collapseValue");
    expect(collapse).toBeDefined();

    const exit = calls.find(c => c.type === "exitOperator" && c.outcome === "collapsed");
    expect(exit).toBeDefined();
  });

  it("records operator errors", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    let thrown: any;

    try {
      for await (const _ of from([1]).pipe(
        map(() => { throw new Error("boom"); })
      )) {}
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeTruthy();

    const error = calls.find(c => c.type === "errorInOperator");
    expect(error).toBeDefined();
  });

  it("traces subscription completion on early exit (break)", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    for await (const _v of from([1, 2, 3]).pipe(map(x => x))) {
      break;
    }

    const complete = calls.find(c => c.type === "completeSubscription");
    expect(complete).toBeDefined();
  });

  it("traces subscription completion on iterator throw", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const stream = from([1]).pipe(map(x => x));
    const iter = stream[Symbol.asyncIterator]();

    // Start it
    await iter.next();

    // Throw into it
    try {
      if (iter.throw) {
        await iter.throw(new Error("Manual throw"));
      }
    } catch (e) {
      // expected
    }

    const complete = calls.find(c => c.type === "completeSubscription");
    expect(complete).toBeDefined();
  });

});
