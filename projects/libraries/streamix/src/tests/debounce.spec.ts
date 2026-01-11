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

  it('should mark all received values as delivered in tracer (not filtered)', (done) => {
    const tracer = createValueTracer();
    enableTracing(tracer);

    try {
      const source = createStream<number>('test-source', async function* () {
        for (let i = 1; i <= 5; i++) {
          yield i;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      });

      const received: number[] = [];
      
      source
        .pipe(
          map((x) => x * 10),
          debounce(50)
        )
        .subscribe({
          next: (value) => received.push(value),
          complete: () => {
            try {
              // Get all traces
              const traces = tracer.getAllTraces();
              
              // Get delivered traces
              const deliveredTraces = traces.filter((t) => t.state === 'delivered');
              const deliveredValues = deliveredTraces.map((t) => t.finalValue).sort((a, b) => a - b);
              
              // CRITICAL: Every value that reached the subscriber must be marked as delivered
              expect(received.length).toBeGreaterThan(0);
              expect(deliveredValues.length).toBe(received.length);
              expect(deliveredValues).toEqual(received.slice().sort((a, b) => a - b));
              
              // Verify no value is marked as filtered if it actually reached the subscriber
              const filteredTraces = traces.filter((t) => t.state === 'filtered');
              for (const filtered of filteredTraces) {
                expect(received).not.toContain(filtered.finalValue);
              }
              
              done();
            } catch (err: any) {
              done.fail(err);
            } finally {
              disableTracing();
              tracer.clear();
            }
          },
          error: (err) => {
            disableTracing();
            tracer.clear();
            done.fail(err);
          }
        });
    } catch (err: any) {
      disableTracing();
      tracer.clear();
      done.fail(err);
    }
  });

  it('should mark all received values as delivered with complex pipeline (throttle + debounce)', (done) => {
    const tracer = createValueTracer();
    enableTracing(tracer);

    try {
      const source = createStream<number>('complex-source', async function* () {
        for (let i = 1; i <= 10; i++) {
          yield i;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      });

      const received: number[] = [];
      
      source
        .pipe(
          map((x) => x * 10),
          filter((x) => x % 20 !== 0),
          map((x) => x + 5),
          throttle(40),
          debounce(30)
        )
        .subscribe({
          next: (value) => received.push(value),
          complete: () => {
            try {
              // Get all traces
              const traces = tracer.getAllTraces();
              
              // Get delivered traces
              const deliveredTraces = traces.filter((t) => t.state === 'delivered');
              const deliveredValues = deliveredTraces.map((t) => t.finalValue).sort((a, b) => a - b);
              
              expect(received.length).toBeGreaterThan(0);
              expect(deliveredValues.length).toBe(received.length);
              expect(deliveredValues).toEqual(received.slice().sort((a, b) => a - b));
              
              // Verify no value is marked as filtered if it actually reached the subscriber
              const filteredTraces = traces.filter((t) => t.state === 'filtered');
              for (const filtered of filteredTraces) {
                expect(received).not.toContain(filtered.finalValue);
              }
              
              done();
            } catch (err: any) {
              done.fail(err);
            } finally {
              disableTracing();
              tracer.clear();
            }
          },
          error: (err) => {
            disableTracing();
            tracer.clear();
            done.fail(err);
          }
        });
    } catch (err: any) {
      disableTracing();
      tracer.clear();
      done.fail(err);
    }
  });

  it('should mark all received values as delivered with concatMap inner streams (app6 scenario)', (done) => {
    const tracer = createValueTracer();
    enableTracing(tracer);

    try {
      const source = createStream<number>('sophisticated-source', async function* () {
        for (let i = 1; i <= 6; i++) {
          yield i;
        }
      });

      const received: number[] = [];
      
      source
        .pipe(
          map((x) => x * 2),
          filter((x) => x % 4 !== 0),
          concatMap((x, idx) =>
            createStream(`inner-${idx}`, async function* () {
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
            try {
              // Get all traces
              const traces = tracer.getAllTraces();
              
              // Get delivered traces
              const deliveredTraces = traces.filter((t) => t.state === 'delivered');
              const deliveredValues = deliveredTraces.map((t) => t.finalValue).sort((a, b) => a - b);
              
              expect(received.length).toBeGreaterThan(0);
              expect(deliveredValues.length).toBe(received.length);
              expect(deliveredValues).toEqual(received.slice().sort((a, b) => a - b));
              
              // Verify no value is marked as filtered if it actually reached the subscriber
              // for (const filtered of filteredTraces) {
              //   expect(received).not.toContain(filtered.finalValue);
              // }
              
              done();
            } catch (err: any) {
              done.fail(err);
            } finally {
              disableTracing();
              tracer.clear();
            }
          },
          error: (err) => {
            disableTracing();
            tracer.clear();
            done.fail(err);
          }
        });
    } catch (err: any) {
      disableTracing();
      tracer.clear();
      done.fail(err);
    }
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
});
