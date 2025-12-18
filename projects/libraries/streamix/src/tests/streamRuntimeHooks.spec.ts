import { createStream, map, registerRuntimeHooks, scheduler } from "@actioncrew/streamix";

describe("stream runtime hooks", () => {
  let previousHooks: any;

  beforeEach(() => {
    previousHooks = (globalThis as any).__STREAMIX_RUNTIME_HOOKS__ ?? null;
  });

  afterEach(() => {
    (globalThis as any).__STREAMIX_RUNTIME_HOOKS__ = previousHooks;
  });

  it("wrapReceiver converts non-Error throws into Error", async () => {
    registerRuntimeHooks({});
    const stream = createStream("test", async function* () {
      yield 1;
    });

    await new Promise<void>((resolve) => {
      stream.subscribe({
        next: () => {
          throw "BAD";
        },
        error: (err) => {
          expect(err).toEqual(jasmine.any(Error));
          expect((err as Error).message).toBe("BAD");
          resolve();
        },
      });
    });

    await scheduler.flush();
  });

  it("drainIterator converts non-Error generator throws into Error", async () => {
    registerRuntimeHooks({});

    const stream = createStream("nonErrorThrow", async function* () {
      throw "BOOM";
    });

    await new Promise<void>((resolve) => {
      stream.subscribe({
        error: (err) => {
          expect(err).toEqual(jasmine.any(Error));
          expect((err as Error).message).toBe("BOOM");
          resolve();
        },
      });
    });

    await scheduler.flush();
  });

  it("applies onCreateStream and onPipeStream patches (source/operators/final)", async () => {
    const onCreateStream = jasmine.createSpy("onCreateStream");

    registerRuntimeHooks({
      onCreateStream,
      onPipeStream: (ctx) => {
        const patchedSource: AsyncIterator<any> = {
          next: async () => {
            const r = await ctx.source.next();
            return r.done ? r : { done: false, value: (r.value as number) + 100 };
          },
          return: ctx.source.return?.bind(ctx.source),
          throw: ctx.source.throw?.bind(ctx.source),
        };

        return {
          source: patchedSource,
          operators: ctx.operators,
          final: (it) => ({
            async next() {
              const r = await it.next();
              return r.done ? r : { done: false, value: (r.value as number) + 1000 };
            },
            return: it.return?.bind(it),
            throw: it.throw?.bind(it),
          }),
        };
      },
    });

    const src = createStream("src", async function* () {
      yield 1;
    });

    expect(onCreateStream).toHaveBeenCalled();

    const value = await src.pipe(map((x) => x + 1)).query();
    expect(value).toBe(1102); // (1 + 100) + 1 + 1000
  });
});
