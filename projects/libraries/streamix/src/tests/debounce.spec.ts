import {
  concatMap,
  createStream,
  debounce,
  distinctUntilChanged,
  filter,
  from,
  interval,
  map,
  scan,
  scheduler,
  take,
  throttle
} from "@epikodelabs/streamix";
import { createValueTracer, disableTracing, enableTracing } from "@epikodelabs/streamix/tracing";

describe('debounce', () => {
  it('should debounce values from an array stream', (done) => {
    const values = [1, 2, 3, 4, 5];
    // `from(array)` completes synchronously; debounce should flush the latest value on completion
    // even if the configured duration hasn't elapsed yet.
    const debouncedStream = from(values).pipe(debounce(10_000));
    const emittedValues: number[] = [];

    debouncedStream.subscribe({
      next: (value: number) => emittedValues.push(value),
      complete: () => {
        // Only the last value should be emitted due to debounce
        expect(emittedValues).toEqual([5]);
        done();
      },
      error: done.fail,
    });
  });

  it('should debounce values from an interval stream', (done) => {
    const source$ = interval(50).pipe(take(5)); // Emits 0,1,2,3,4 at intervals of 50ms
    const debouncedStream = source$.pipe(debounce(120)); // Debounces emissions

    const emittedValues: number[] = [];

    debouncedStream.subscribe({
      next: (value: number) => emittedValues.push(value),
      complete: () => {
        // Expecting only the last emission to be debounced and received
        expect(emittedValues.length).toBe(1);
        expect(emittedValues[0]).toBe(4); // Last value after debounce period
        done();
      },
    });
  });

  it('should debounce values with rapid emissions', (done) => {
    const values = [1, 2, 3, 4, 5];
    const intervalStream = createStream<number>("interval", async function* () {
      for (const value of values) {
        yield value;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    });

    const debouncedStream = intervalStream.pipe(debounce(100));
    const emittedValues: number[] = [];

    debouncedStream.subscribe({
      next: (value: number) => emittedValues.push(value),
      complete: () => {
        // Only the last value should be emitted due to debounce
        expect(emittedValues).toEqual([5]);
        done();
      },
    });
  });

  it('should support promise-based duration', (done) => {
    const debouncedStream = from([1, 2, 3]).pipe(debounce(Promise.resolve(10)));
    const emittedValues: number[] = [];

    debouncedStream.subscribe({
      next: (value: number) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([3]);
        done();
      },
      error: done.fail,
    });
  });

  it('should flush on completion when duration is undefined', (done) => {
    const debouncedStream = from([1, 2, 3]).pipe(debounce(undefined as any));
    const emittedValues: number[] = [];

    debouncedStream.subscribe({
      next: (value: number) => emittedValues.push(value),
      complete: () => {
        expect(emittedValues).toEqual([3]);
        done();
      },
      error: done.fail,
    });
  });

  it('should propagate errors from the source', (done) => {
    const source$ = createStream<number>("boom", async function* () {
      yield 1;
      throw new Error("BOOM");
    });

    const debouncedStream = source$.pipe(debounce(0));

    const values: number[] = [];
    debouncedStream.subscribe({
      next: (v) => values.push(v),
      error: (err) => {
        expect(values).toEqual([]); // never flushed before error
        expect(err).toEqual(jasmine.any(Error));
        expect((err as Error).message).toBe("BOOM");
      },
      complete: () => done(),
    });
  });

  it("should trace debounce in the demo-sophisticated pipeline (no dangling transformed inputs)", async () => {
    const previousTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 20_000;

    const tracer = createValueTracer();
    enableTracing(tracer);
    jasmine.clock().install();

    try {
      const sophisticatedSource = createStream('demo-sophisticated', async function* () {
        for (let i = 1; i <= 30; i += 1) {
          yield i;
          await new Promise((resolve) => setTimeout(resolve, 12 + (i % 6) * 7));
        }
      });

      const received: number[] = [];
      let completed = false;
      let error: unknown;

      sophisticatedSource
        .pipe(
          map((x) => x * 2),
          filter((x) => x % 4 !== 0),
          concatMap((x, idx) =>
            createStream(`inner-soph-${idx}`, async function* () {
              yield x;
              await new Promise((resolve) => setTimeout(resolve, 8));
              yield x + idx;
              await new Promise((resolve) => setTimeout(resolve, 6));
              yield x * 10;
            })
          ),
          scan((acc, x) => acc + x, 0),
          distinctUntilChanged(),
          map((sum) => sum % 1000),
          throttle(30),
          debounce(15)
        )
        .subscribe({
          next: (value) => received.push(value),
          complete: () => {
            completed = true;
          },
          error: (err) => {
            error = err;
            completed = true;
          },
        });

      for (let elapsedMs = 0; elapsedMs < 20_000 && !completed; elapsedMs += 5) {
        jasmine.clock().tick(5);
        await scheduler.flush();
      }

      // Flush any timers queued in the same tick as completion (debounce/throttle trailing).
      jasmine.clock().tick(2_000);
      await scheduler.flush();

      if (error) throw error;
      expect(completed).toBeTrue();

      // This pipeline is time-based and should be deterministic under a fake clock.
      // Lock down the exact output if you adjust the timing/constants above.
      const expected = [
        2, 24, 30, 97, 119, 219, 250, 390, 430, 610, 659, 879, 937, 197, 264, 564,
        640, 980, 65, 445, 539, 959, 62, 522, 634, 134, 255, 795, 925, 505,
      ];
      expect(received).toEqual(expected);

      const traces = tracer.getAllTraces();

      const deliveredWithDebounce = traces.filter(
        (t) =>
          t.state === "delivered" &&
          (t.operatorSteps ?? []).some((s) => s.operatorName === "debounce")
      );
      expect(deliveredWithDebounce.length).toBeGreaterThan(0);

      // Source emits 30 base values; concatMap expands those into child traces.
      const baseTraces = traces.filter((t) => t.parentTraceId == null);
      expect(baseTraces.length).toBe(30);

      // After completion, nothing should be left in a non-terminal state.
      const nonTerminalTraces = traces.filter(
        (t) => t.state === "emitted" || t.state === "transformed"
      );
      expect(nonTerminalTraces.length).toBe(0);

      // No dangling operator steps (entered but never exited).
      const danglingSteps = traces.filter((t) =>
        (t.operatorSteps ?? []).some((s) => s.exitedAt === undefined)
      );
      expect(danglingSteps.length).toBe(0);

      const filteredByRateLimit = traces.filter(
        (t) =>
          t.state === "filtered" &&
          (t.operatorSteps ?? []).some(
            (s) =>
              (s.operatorName === "throttle" || s.operatorName === "debounce") &&
              s.outcome === "filtered"
          )
      );
      expect(filteredByRateLimit.length).toBeGreaterThan(0);

      const danglingDebounce = traces.filter(
        (t) =>
          t.state === "transformed" &&
          (t.operatorSteps ?? []).some((s) => s.operatorName === "debounce")
      );
      expect(danglingDebounce.length).toBe(0);
    } finally {
      jasmine.clock().uninstall();
      disableTracing();
      tracer.clear();
      jasmine.DEFAULT_TIMEOUT_INTERVAL = previousTimeout;
    }
  });
});
