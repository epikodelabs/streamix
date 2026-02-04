import {
    createTraceStore,
    createTracerSubscriptions,
    defaultOpName,
    toValueState,
    unwrapForExport, wrapTracedValue
} from "@epikodelabs/streamix/tracing";

describe("tracerUtilities", () => {

  describe("defaultOpName", () => {
    it("should generate op name based on index", () => {
      expect(defaultOpName(0)).toBe("op0");
      expect(defaultOpName(1)).toBe("op1");
      expect(defaultOpName(99)).toBe("op99");
    });
  });

  describe("unwrapForExport", () => {
    it("should unwrap traced values", () => {
      const wrapped = wrapTracedValue("test", { valueId: "v1" } as any);
      expect(unwrapForExport(wrapped)).toBe("test");
    });

    it("should unwrap primitive wrappers if present", () => {
        // Assuming unwrapPrimitive handles objects that look like primitive wrappers
        // For now just testing basic value pass-through or simple unwrap if applicable
        expect(unwrapForExport(123)).toBe(123);
    });
  });

  describe("createTraceStore", () => {
    it("should store and retrieve traces", () => {
      const store = createTraceStore<string>(10);
      store.retainTrace("v1", "trace1");
      expect(store.traces.get("v1")).toBe("trace1");
    });

    it("should verify LRU eviction behavior", () => {
      const store = createTraceStore<string>(2);
      store.retainTrace("v1", "trace1");
      store.retainTrace("v2", "trace2");
      expect(store.traces.size).toBe(2);

      store.retainTrace("v3", "trace3");
      // v1 should be evicted (first key inserted)
      expect(store.traces.size).toBe(2);
      expect(store.traces.has("v1")).toBe(false);
      expect(store.traces.has("v2")).toBe(true);
      expect(store.traces.has("v3")).toBe(true);
    });

    it("should clear traces", () => {
      const store = createTraceStore<string>(10);
      store.retainTrace("v1", "trace1");
      store.clearTraces();
      expect(store.traces.size).toBe(0);
    });
  });

  describe("createTracerSubscriptions", () => {
    it("should manage subscribers and notify them", () => {
        const subs = createTracerSubscriptions();
        const spy = jasmine.createSpy("emitted");
        
        const unsub = subs.subscribe({ emitted: spy });
        
        const trace = { valueId: "v1", subscriptionId: "s1" } as any;
        subs.notify("emitted", trace);
        
        expect(spy).toHaveBeenCalledWith(trace);
        
        unsub();
        spy.calls.reset();
        subs.notify("emitted", trace);
        expect(spy).not.toHaveBeenCalled();
    });

    it("should manage specific subscription observers", () => {
        const subs = createTracerSubscriptions();
        const spy = jasmine.createSpy("emitted");
        
        const unsub = subs.observeSubscription("s1", { emitted: spy });
        
        const traceS1 = { valueId: "v1", subscriptionId: "s1" } as any;
        const traceS2 = { valueId: "v2", subscriptionId: "s2" } as any;
        
        subs.notify("emitted", traceS1);
        expect(spy).toHaveBeenCalledWith(traceS1);
        
        spy.calls.reset();
        subs.notify("emitted", traceS2);
        expect(spy).not.toHaveBeenCalled();

        unsub();
        spy.calls.reset();
        subs.notify("emitted", traceS1);
        expect(spy).not.toHaveBeenCalled();
    });

    it("should track active/completed subscriptions", () => {
        const subs = createTracerSubscriptions();
        
        subs.ensureActive("s1");
        expect(subs.isCompleted("s1")).toBe(false);
        
        subs.completeSubscription("s1");
        expect(subs.isCompleted("s1")).toBe(true);
        
        // Completing again should be safe
        subs.completeSubscription("s1");
        expect(subs.isCompleted("s1")).toBe(true);
    });
    
    it("should notify observers on completion", () => {
        const subs = createTracerSubscriptions();
        const spy = jasmine.createSpy("complete");
        
        subs.observeSubscription("s1", { complete: spy });
        subs.ensureActive("s1");
        
        subs.completeSubscription("s1");
        expect(spy).toHaveBeenCalled();
    });

    it("should clear subscriptions", () => {
        const subs = createTracerSubscriptions();
        subs.ensureActive("s1");
        subs.clearSubscriptions();
        // Since state is cleared, it shouldn't know about s1 anymore (so not completed)
        expect(subs.isCompleted("s1")).toBe(false);
    });
  });

  describe("toValueState", () => {
    it("should map delivered status", () => {
        expect(toValueState({ status: "delivered" })).toBe("delivered");
    });

    it("should map terminal statuses", () => {
        expect(toValueState({ status: "terminal", terminalReason: "filtered" })).toBe("filtered");
        expect(toValueState({ status: "terminal", terminalReason: "collapsed" })).toBe("collapsed");
        expect(toValueState({ status: "terminal", terminalReason: "errored" })).toBe("errored");
        expect(toValueState({ status: "terminal", terminalReason: "late" })).toBe("dropped");
        // default fallback
        expect(toValueState({ status: "terminal", terminalReason: "unknown" as any })).toBe("dropped");
    });

    it("should map active statuses correctly", () => {
        expect(toValueState({ status: "active", expandedFrom: {} })).toBe("expanded");
        expect(toValueState({ status: "active", expandedInto: [1] })).toBe("expanded");
        expect(toValueState({ status: "active", parentTraceId: "p1" })).toBe("expanded");
        
        expect(toValueState({ status: "active", hasOperatorSteps: true })).toBe("transformed");
        expect(toValueState({ status: "active", hasFinalValue: true })).toBe("transformed");
        
        expect(toValueState({ status: "active" })).toBe("emitted");
    });
  });
});
