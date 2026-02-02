import {
  disableTracing,
  enableTracing,
  installTracingHooks,
  type ValueTracer,
} from "@epikodelabs/streamix/tracing";

import {
  audit,
  buffer,
  bufferCount,
  bufferUntil,
  bufferWhile,
  catchError,
  concatMap,
  createStream,
  debounce,
  defaultIfEmpty,
  delay as delayOp,
  delayUntil,
  delayWhile,
  distinctUntilChanged,
  distinctUntilKeyChanged,
  endWith,
  exhaustMap,
  expand,
  filter,
  finalize,
  first,
  fork,
  from,
  groupBy,
  ignoreElements,
  last,
  map,
  mergeMap,
  observeOn,
  partition,
  reduce,
  sample,
  scan,
  select,
  share,
  shareReplay,
  skip,
  skipUntil,
  skipWhile,
  slidingPair,
  startWith,
  switchMap,
  take,
  takeUntil,
  takeWhile,
  tap,
  throttle,
  throwError,
  toArray as toArrayOp,
  withLatestFrom,
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

async function toArray<T>(stream: Stream<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of stream as any) out.push(v);
  return out;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function idsOf(calls: any[], type: string): string[] {
  return calls.filter((c) => c.type === type).map((c) => c.vId);
}

function expandedIdsOf(calls: any[]): string[] {
  return calls
    .filter((c) => c.type === "createExpandedTrace")
    .map((c) => c.id as string);
}

function expectNoOrphanDeliveries(calls: any[]) {
  const started = idsOf(calls, "startTrace");
  const expanded = expandedIdsOf(calls);
  const delivered = idsOf(calls, "markDelivered");

  expect(unique(started).length).toBe(started.length);

  const known = new Set<string>([...started, ...expanded]);
  for (const vId of delivered) {
    expect(known.has(vId)).toBeTrue();
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: any;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

type Case = {
  name: string;
  run: () => Promise<void>;
};

installTracingHooks();

describe("tracingCompliance", () => {
  afterEach(() => disableTracing());

  const cases: Case[] = [
    {
      name: "audit",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const source = createStream<number>("audit_source", async function* () {
          yield 1;
          await delay(25);
          yield 1;
          await delay(25);
        });

        const out = await toArray(source.pipe(audit(10)));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "buffer",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        // `buffer` is time-based (flush every N ms). Here we rely on the final flush on completion.
        const out = await toArray(from([1, 1, 2]).pipe(buffer(1000)));
        expect(out).toEqual([[1, 1, 2]]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "bufferCount",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(bufferCount(2)));
        expect(out).toEqual([[1, 1], [2]]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "bufferUntil",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        // Notifier emits once to trigger a flush while the source is still alive.
        const notifier = createStream<boolean>("bufferUntil_notifier", async function* () {
          await delay(10);
          yield true;
        });
        const source = createStream<number>("bufferUntil_source", async function* () {
          yield 1;
          yield 1;
          await delay(30);
        });

        const out = await toArray(source.pipe(bufferUntil(notifier)));
        expect(out).toEqual([[1, 1]]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "bufferWhile",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(bufferWhile((_v, idx) => idx < 2)));
        expect(out).toEqual([[1, 1], [2]]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "catchError",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const source = createStream<number>("catchError_source", async function* () {
          yield 1;
          throw new Error("boom");
        });

        let handled = 0;
        const out = await toArray(source.pipe(catchError(() => { handled++; })));
        expect(out).toEqual([1]);
        expect(handled).toBe(1);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "concatMap",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(concatMap((v) => [v, v])));
        expect(out).toEqual([1, 1, 1, 1, 2, 2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "debounce",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const source = createStream<number>("debounce_source", async function* () {
          yield 1;
          await delay(25);
          yield 1;
          await delay(25);
        });

        const out = await toArray(source.pipe(debounce(10)));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "defaultIfEmpty",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([] as number[]).pipe(defaultIfEmpty(123)));
        expect(out).toEqual([123]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "delay",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const source = createStream<number>("delay_source", async function* () {
          yield 1;
          await delay(5);
          yield 1;
          await delay(5);
        });

        const out = await toArray(source.pipe(delayOp(5)));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "delayUntil",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const notifier = delay(10).then(() => true);
        const source = createStream<number>("delayUntil_source", async function* () {
          yield 1;
          yield 1;
          await delay(50);
        });

        const out = await toArray(source.pipe(delayUntil(notifier)));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "delayWhile",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(delayWhile((_v, idx) => idx === 0)));
        expect(out).toEqual([1, 1, 2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "distinctUntilChanged",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2, 2, 2, 1]).pipe(distinctUntilChanged()));
        expect(out).toEqual([1, 2, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "distinctUntilKeyChanged",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const src = from([
          { k: 1, v: 1 },
          { k: 1, v: 2 },
          { k: 2, v: 3 },
          { k: 2, v: 4 },
        ]);

        const out = await toArray(src.pipe(distinctUntilKeyChanged("k")));
        expect(out.map((x) => x.k)).toEqual([1, 2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "endWith",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1]).pipe(endWith(9)));
        expect(out).toEqual([1, 1, 9]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "exhaustMap",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        // Use a projection that completes after a short delay.
        const out = await toArray(
          from([1, 1, 2]).pipe(
            exhaustMap((v) =>
              createStream<number>("exhaustMap_inner", async function* () {
                yield v;
                await delay(10);
              })
            )
          )
        );

        // Depending on timing, exhaustMap may drop some values; just enforce tracing invariants.
        expect(out.length).toBeGreaterThan(0);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "expand",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(
          from([1, 2]).pipe(
            expand((v) => [v], { maxDepth: 1 })
          )
        );

        // Default traversal is depth-first: each parent is followed by its children.
        expect(out).toEqual([1, 1, 2, 2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "filter",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2, 3]).pipe(filter((v) => v !== 1)));
        expect(out).toEqual([2, 3]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "finalize",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        let finalized = 0;
        const out = await toArray(from([1, 1, 2]).pipe(finalize(() => { finalized++; })));
        expect(out).toEqual([1, 1, 2]);
        expect(finalized).toBe(1);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "first",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(first()));
        expect(out).toEqual([1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "fork",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(
          from([1, 2]).pipe(
            fork(
              { on: (v) => v === 1, handler: (v) => [v, v] },
              { on: (v) => v === 2, handler: (v) => [v] }
            )
          )
        );

        expect(out).toEqual([1, 1, 2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "groupBy",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(groupBy((v) => (v === 1 ? "a" : "b"))));
        expect(out.map((x: any) => x.key)).toEqual(["a", "a", "b"]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "ignoreElements",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(ignoreElements()));
        expect(out).toEqual([]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "last",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(last()));
        expect(out).toEqual([2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "map",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(map((v) => v + 1)));
        expect(out).toEqual([2, 2, 3]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "mergeMap",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(mergeMap((v) => [v, v])));
        expect(out).toEqual([1, 1, 1, 1, 2, 2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "observeOn",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const source = createStream<number>("observeOn_source", async function* () {
          yield 1;
          await delay(5);
          yield 1;
          await delay(5);
        });

        const out = await toArray(source.pipe(observeOn("macrotask")));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "partition",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(partition((v) => v === 1)));
        expect(out.map((x: any) => x.key)).toEqual(["true", "true", "false"]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "reduce",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(reduce((acc, v) => acc + v, 0)));
        expect(out).toEqual([4]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "sample",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const source = createStream<number>("sample_source", async function* () {
          yield 1;
          await delay(25);
          yield 1;
          await delay(5);
        });

        const out = await toArray(source.pipe(sample(10)));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "scan",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(scan((acc, v) => acc + v, 0)));
        expect(out).toEqual([1, 2, 4]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "select",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const indices = [0, 2][Symbol.iterator]();
        const out = await toArray(from([1, 1, 2, 3]).pipe(select(indices)));
        expect(out).toEqual([1, 2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "share",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const stream = from([1, 1]).pipe(share());
        await delay(0);

        const out = await toArray(stream);
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "shareReplay",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const stream = from([1, 1]).pipe(shareReplay(2));
        await delay(0);

        const out = await toArray(stream);
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "skip",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(skip(2)));
        expect(out).toEqual([2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "skipUntil",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const notifier = delay(10).then(() => true);
        const source = createStream<number>("skipUntil_source", async function* () {
          yield 1;
          await delay(20);
          yield 2;
        });

        const out = await toArray(source.pipe(skipUntil(notifier)));
        expect(out).toEqual([2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "skipWhile",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2, 3]).pipe(skipWhile((v) => v === 1)));
        expect(out).toEqual([2, 3]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "slidingPair",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(slidingPair()));
        expect(out).toEqual([
          [undefined, 1],
          [1, 1],
          [1, 2],
        ]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "startWith",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1]).pipe(startWith(9)));
        expect(out).toEqual([9, 1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "switchMap",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        // Use an async outer stream so switchMap doesn't fast-drain via __tryNext,
        // which would cancel the first inner before it can fully emit.
        const outer = createStream<number>("switchMap_outer", async function* () {
          yield 1;
          await delay(25);
          yield 2;
        });

        const out = await toArray(outer.pipe(switchMap((v) => [v, v])));
        expect(out).toEqual([1, 1, 2, 2]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "take",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(take(2)));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "takeUntil",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const notifier = delay(10).then(() => true);
        const source = createStream<number>("takeUntil_source", async function* () {
          yield 1;
          await delay(20);
          yield 2;
        });

        const out = await toArray(source.pipe(takeUntil(notifier)));
        expect(out).toEqual([1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "takeWhile",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2, 3]).pipe(takeWhile((v) => v !== 2)));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "tap",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        let seen = 0;
        const out = await toArray(from([1, 1, 2]).pipe(tap(() => { seen++; })));
        expect(out).toEqual([1, 1, 2]);
        expect(seen).toBe(3);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "throttle",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const source = createStream<number>("throttle_source", async function* () {
          yield 1;
          await delay(1);
          yield 1;
          await delay(5);
        });

        const out = await toArray(source.pipe(throttle(25)));
        expect(out).toEqual([1, 1]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "throwError",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const stream = from([1]).pipe(throwError("boom"));
        let threw = false;
        try {
          await toArray(stream);
        } catch {
          threw = true;
        }
        expect(threw).toBeTrue();
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "toArray",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 1, 2]).pipe(toArrayOp()));
        expect(out).toEqual([[1, 1, 2]]);
        expectNoOrphanDeliveries(calls);
      },
    },
    {
      name: "withLatestFrom",
      run: async () => {
        const { tracer, calls } = createTestTracer();
        enableTracing(tracer);

        const out = await toArray(from([1, 2]).pipe(withLatestFrom(from([10]))));
        expect(out).toEqual([
          [1, 10],
          [2, 10],
        ]);
        expectNoOrphanDeliveries(calls);
      },
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      await withTimeout(c.run(), 10_000, c.name);
    });
  }
});
