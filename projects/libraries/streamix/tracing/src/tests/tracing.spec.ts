import {
  disableTracing,
  enableTracing,
  generateValueId,
  getGlobalTracer,
  getValueId,
  isTracedValue,
  unwrapTracedValue,
  ValueTracer,
  wrapTracedValue,
} from "@epikodelabs/streamix/tracing";

import {
  applyPipeStreamHooks,
  createOperator,
  filter,
  from,
  getIteratorMeta,
  map,
  mergeMap,
  reduce,
  setValueMeta,
} from "@epikodelabs/streamix";

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

describe("Streamix tracing core", () => {

  afterEach(() => disableTracing());

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

  it("does not trace when no global tracer is enabled", async () => {
    const { calls } = createTestTracer();

    const out: number[] = [];
    for await (const v of from([1, 2]).pipe(map((x) => x + 1))) {
      out.push(v);
    }

    expect(out).toEqual([2, 3]);
    expect(calls.length).toBe(0);
  });

  it("does not retroactively trace if tracing is enabled after hooks are applied", async () => {
    const { tracer, calls } = createTestTracer();

    // Build the iterator while tracing is disabled; hooks short-circuit at pipe time.
    const it = applyPipeStreamHooks({
      streamId: "s_late_enable",
      streamName: "lateEnable",
      subscriptionId: "sub_late_enable",
      source: from([1]).pipe(map((x) => x + 1))[Symbol.asyncIterator](),
      operators: [],
    });

    enableTracing(tracer);

    const out: number[] = [];
    for await (const v of it as any) {
      out.push(v);
    }

    expect(out).toEqual([2]);
    expect(calls.length).toBe(0);
  });

  it("marks delivered using value metadata when a value escapes without traced wrapper", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const metaValueId = "val_meta_deliver";
    const emitNoInput = createOperator("emitNoInput", () => {
      let emitted = false;
      return {
        async next() {
          if (emitted) return { done: true, value: undefined } as any;
          emitted = true;

          const value = { n: 123 };
          const tagged = setValueMeta(value, { valueId: metaValueId }, 0, "emitNoInput");
          return { done: false, value: tagged } as const;
        },
      } as any;
    });

    // This operator emits without consuming input, so the tracing operator wrapper
    // loses metadata correlation and returns an unwrapped value.
    const out: any[] = [];
    for await (const v of from([1]).pipe(emitNoInput)) {
      out.push(v);
    }

    expect(out.length).toBe(1);
    expect(out[0]).toEqual({ n: 123 });

    expect(calls.some((c) => c.type === "markDelivered" && c.vId === metaValueId)).toBeTrue();
    expect(calls.some((c) => c.type === "completeSubscription")).toBeTrue();
  });

  it("respects parentValueId (does not call startTrace)", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const source: AsyncIterator<number> = {
      idx: 0,
      async next(this: any) {
        this.idx += 1;
        if (this.idx === 1) return { done: false, value: 123 } as const;
        return { done: true, value: undefined } as any;
      },
    } as any;

    const it = applyPipeStreamHooks({
      streamId: "s_parent",
      streamName: "parent",
      subscriptionId: "sub_parent",
      parentValueId: "val_parent",
      source,
      operators: [],
    });

    const r1 = await it.next();
    expect(r1.done).toBeFalse();
    expect(r1.value).toBe(123);
    const r2 = await it.next();
    expect(r2.done).toBeTrue();

    expect(calls.some((c) => c.type === "startTrace")).toBeFalse();
    expect(calls.some((c) => c.type === "markDelivered" && c.vId === "val_parent")).toBeTrue();
  });

  it("passes through already traced values from upstream sources", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const source: AsyncIterator<any> = {
      done: false,
      async next(this: any) {
        if (this.done) return { done: true, value: undefined } as any;
        this.done = true;
        return {
          done: false,
          value: wrapTracedValue(7, { valueId: "v_up", streamId: "s_up", subscriptionId: "sub_up" }),
        } as const;
      },
    } as any;

    const it = applyPipeStreamHooks({
      streamId: "s_pass",
      streamName: "pass",
      subscriptionId: "sub_pass",
      source,
      operators: [],
    });

    const r1 = await it.next();
    expect(r1).toEqual({ done: false, value: 7 });
    await it.next();

    expect(calls.some((c) => c.type === "startTrace")).toBeFalse();
    expect(calls.some((c) => c.type === "markDelivered" && c.vId === "v_up")).toBeTrue();
  });

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

    const start = calls.find((c) => c.type === "startTrace");
    expect(start).toBeDefined();

    const error = calls.find((c) => c.type === "errorInOperator");
    expect(error).toBeDefined();
    expect(error.args[0]).toBe(start.vId);
    expect(error.args[1]).toBe(0);
    expect(error.args[2]).toEqual(jasmine.any(Error));
    expect((error.args[2] as Error).message).toBe("boom");

    expect(calls.some((c) => c.type === "markDelivered")).toBeFalse();
    expect(calls.some((c) => c.type === "completeSubscription")).toBeFalse();
  });

  it("marks pending inputs as filtered when an operator completes early", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const drainAndComplete = createOperator<number, number>("drainAndComplete", (source) => ({
      async next() {
        const r = await source.next();
        if (r.done) return r;
        // Consume a value but signal completion without emitting it.
        return { done: true, value: undefined } as IteratorResult<number>;
      },
    }));

    const out: number[] = [];
    for await (const v of from([1]).pipe(drainAndComplete)) {
      out.push(v);
    }

    expect(out).toEqual([]);
    expect(calls.some((c) => c.type === "exitOperator" && c.filtered === true && c.opIdx === 0)).toBeTrue();
    expect(calls.some((c) => c.type === "markDelivered")).toBeFalse();
    expect(calls.some((c) => c.type === "completeSubscription")).toBeTrue();
  });

  it("filters all pending inputs when an operator pulls multiple values then completes", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const drainTwoAndComplete = createOperator<number, number>("drainTwoAndComplete", (source) => ({
      async next() {
        const a = await source.next();
        if (a.done) return a;
        const b = await source.next();
        if (b.done) return b;
        return { done: true, value: undefined } as IteratorResult<number>;
      },
      [Symbol.asyncIterator]() { return this; },
    }));

    const out: number[] = [];
    for await (const v of from([1, 2, 3]).pipe(drainTwoAndComplete)) {
      out.push(v);
    }

    expect(out).toEqual([]);

    const filteredExits = calls.filter((c) => c.type === "exitOperator" && c.filtered === true && c.opIdx === 0);
    expect(filteredExits.length).toBe(2);
    expect(calls.some((c) => c.type === "completeSubscription")).toBeTrue();
  });

  it("handles multiple inputs producing a new output (collapse case)", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const sumTwo = createOperator<number, number>("sumTwo", (source) => ({
      async next() {
        const a = await source.next();
        if (a.done) return a;
        const b = await source.next();
        if (b.done) return b;
        return { done: false, value: (a.value as number) + (b.value as number) };
      },
      [Symbol.asyncIterator]() { return this; },
    }));

    const out: number[] = [];
    for await (const v of from([1, 2]).pipe(sumTwo)) {
      out.push(v);
    }

    expect(out).toEqual([3]);
    expect(calls.some((c) => c.type === "collapseValue")).toBeTrue();
    expect(calls.some((c) => c.type === "exitOperator" && c.outcome === "collapsed")).toBeTrue();
  });

  it("handles multiple inputs where one is passed through (filters others)", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const takeSecond = createOperator<number, number>("takeSecond", (source) => ({
      async next() {
        const a = await source.next();
        if (a.done) return a;
        const b = await source.next();
        if (b.done) return b;
        return { done: false, value: b.value };
      },
      [Symbol.asyncIterator]() { return this; },
    }));

    const out: number[] = [];
    for await (const v of from([1, 2]).pipe(takeSecond)) {
      out.push(v);
    }

    expect(out).toEqual([2]);
    expect(calls.some((c) => c.type === "exitOperator" && c.filtered === true)).toBeTrue();
  });

  it("supports runtime expand metadata for buffered 1→many outputs", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const emitTwice = createOperator<number, number>("emitTwice", (source) => {
      let buffered: number | null = null;
      let baseValueId: string | null = null;

      return {
        async next() {
          if (buffered !== null && baseValueId) {
            const v = buffered;
            buffered = null;
            return {
              done: false,
              value: setValueMeta(v, { valueId: baseValueId, kind: "expand" }, 0, "emitTwice"),
            };
          }

          const r = await source.next();
          if (r.done) return r;

          const meta = getIteratorMeta(source);
          baseValueId = meta?.valueId ?? null;
          buffered = (r.value as number) + 1;

          return {
            done: false,
            value: setValueMeta(r.value, { valueId: baseValueId!, kind: "expand" }, 0, "emitTwice"),
          };
        },
        return: source.return?.bind(source),
        throw: source.throw?.bind(source),
        [Symbol.asyncIterator]() { return this; },
      };
    });

    const out: number[] = [];
    for await (const v of from([10]).pipe(emitTwice)) {
      out.push(v);
    }

    expect(out).toEqual([10, 11]);
    expect(calls.some((c) => c.type === "exitOperator" && c.outcome === "expanded")).toBeTrue();
    expect(calls.some((c) => c.type === "createExpandedTrace")).toBeTrue();
  });

  it("supports runtime collapse metadata with explicit inputValueIds", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const collapseToArray = createOperator<number, number[]>("collapseToArray", (source) => {
      return {
        async next() {
          const a = await source.next();
          if (a.done) return a as any;
          const metaA = getIteratorMeta(source);

          const b = await source.next();
          if (b.done) return b as any;
          const metaB = getIteratorMeta(source);

          const arr = [a.value as number, b.value as number];
          return {
            done: false,
            value: setValueMeta(
              arr,
              {
                kind: "collapse",
                inputValueIds: [metaA!.valueId, metaB!.valueId],
                valueId: metaB!.valueId,
              },
              0,
              "collapseToArray"
            ),
          };
        },
        [Symbol.asyncIterator]() { return this; },
      };
    });

    const out: number[][] = [];
    for await (const v of from([1, 2]).pipe(collapseToArray)) {
      out.push(v);
    }

    expect(out).toEqual([[1, 2]]);
    expect(calls.some((c) => c.type === "collapseValue")).toBeTrue();
    expect(calls.some((c) => c.type === "exitOperator" && c.outcome === "collapsed")).toBeTrue();
  });

  it("final wrapper calls completeSubscription on iterator return/throw", async () => {
    const { tracer, calls } = createTestTracer();
    enableTracing(tracer);

    const it = from([1, 2]).pipe(map((x) => x))[Symbol.asyncIterator]();
    await it.next();

    if (it.return) {
      await it.return(undefined as any);
    }

    let threw = false;
    try {
      if (it.throw) {
        await it.throw(new Error("boom"));
      }
    } catch {
      threw = true;
    }

    expect(threw).toBeTrue();
    expect(calls.some((c) => c.type === "completeSubscription")).toBeTrue();
  });

});
