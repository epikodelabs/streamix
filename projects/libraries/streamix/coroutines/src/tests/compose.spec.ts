import { createStream } from "@epikodelabs/streamix";
import { compose, coroutine } from "@epikodelabs/streamix/coroutines";
import { idescribe } from "./env.spec";

idescribe("compose", () => {
  it("should process tasks sequentially via processTask", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => x * 2);

    const composed = compose(c1, c2);

    const result = await composed.processTask(3); // (3 + 1) * 2
    expect(result).toBe(8);

    await composed.finalize();
  });

  it("should process tasks sequentially in a stream", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => x * 2);

    const stream = createStream("test", async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    const composed = compose(c1, c2);

    const results: number[] = [];
    for await (const v of stream) {
      results.push(await composed.processTask(v));
    }

    // (1+1)*2 = 4, (2+1)*2 = 6, (3+1)*2 = 8
    expect(results).toEqual([4, 6, 8]);

    await composed.finalize();
  });

  it("should propagate errors from inner coroutine", async () => {
    const c1 = coroutine((x: number) => x + 1);
    const c2 = coroutine((x: number) => {
      if (x === 2) throw new Error("boom");
      return x * 2;
    });

    const composed = compose(c1, c2);

    try {
      await composed.processTask(1); // (1+1) => 2, then boom
      fail("Expected error to be thrown");
    } catch (err: any) {
      expect(err.message).toBe("boom");
    }

    await composed.finalize();
  });

  it("should finalize all tasks", async () => {
    const finalized: string[] = [];

    const c1 = {
      processTask: async (x: number) => x + 1,
      finalize: async () => finalized.push("c1"),
    } as any;
    const c2 = {
      processTask: async (x: number) => x * 2,
      finalize: async () => finalized.push("c2"),
    } as any;

    const composed = compose(c1, c2);

    const result = await composed.processTask(5);
    expect(result).toBe(12);

    await composed.finalize();
    expect(finalized).toEqual(["c1", "c2"]);
  });

  it("should handle empty composes gracefully", async () => {
    const composed = compose(); // no tasks
    const result = await composed.processTask(42);

    expect(result).toBe(42);

    await composed.finalize();
  });

  it("passes through values when no tasks are provided", async () => {
    const stream = createStream("test", async function* () {
      yield 1;
      yield 2;
    });

    const passThrough = compose();
    const results: number[] = [];
    for await (const v of stream) {
      results.push(await passThrough.processTask(v));
    }

    expect(results).toEqual([1, 2]);
  });

  it("should finalize every task even when one finalizer throws", async () => {
    const finalized: string[] = [];

    const composed = compose(
      {
        processTask: async (x: number) => x + 1,
        finalize: async () => {
          finalized.push("c1");
          throw new Error("boom");
        },
      } as any,
      {
        processTask: async (x: number) => x * 2,
        finalize: async () => {
          finalized.push("c2");
        },
      } as any
    );

    await expectAsync(composed.finalize()).toBeRejectedWithError("boom");
    expect(finalized).toEqual(["c1", "c2"]);
  });
});


