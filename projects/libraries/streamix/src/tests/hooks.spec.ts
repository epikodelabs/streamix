import {
  applyPipeStreamHooks,
  createOperator,
  generateStreamId,
  generateSubscriptionId,
  getIteratorMeta,
  getRuntimeHooks,
  registerRuntimeHooks,
  setIteratorMeta,
} from "@epikodelabs/streamix";

describe("hooks utilities", () => {
  let previousHooks: ReturnType<typeof getRuntimeHooks>;

  beforeEach(() => {
    previousHooks = getRuntimeHooks();
  });

  afterEach(() => {
    if (previousHooks) {
      registerRuntimeHooks(previousHooks);
    } else {
      registerRuntimeHooks({});
    }
  });

  it("generates sequential stream and subscription identifiers", () => {
    const firstStreamId = parseInt(generateStreamId().split("_")[1], 10);
    const secondStreamId = parseInt(generateStreamId().split("_")[1], 10);
    expect(secondStreamId).toBe(firstStreamId + 1);

    const firstSubscriptionId = parseInt(generateSubscriptionId().split("_")[1], 10);
    const secondSubscriptionId = parseInt(generateSubscriptionId().split("_")[1], 10);
    expect(secondSubscriptionId).toBe(firstSubscriptionId + 1);
  });

  it("registers and returns runtime hooks", () => {
    const hooks = { onCreateStream: () => void 0 };
    registerRuntimeHooks(hooks);
    expect(getRuntimeHooks()).toBe(hooks);
  });

  it("stores iterator metadata", () => {
    const iterator: AsyncIterator<any> = {
      async next() {
        return { done: true, value: undefined };
      },
    };

    setIteratorMeta(iterator, { valueId: "test-value" }, 3, "test-op");
    expect(getIteratorMeta(iterator)).toEqual({
      valueId: "test-value",
      operatorIndex: 3,
      operatorName: "test-op",
    });
  });

  it("applies onPipeStream patches for source, operators, and final", async () => {
    registerRuntimeHooks({
      onPipeStream: (ctx) => ({
        source: {
          async next() {
            const result = await ctx.source.next();
            return result.done
              ? result
              : { done: false, value: (result.value as number) + 1 };
          },
          return: ctx.source.return?.bind(ctx.source),
          throw: ctx.source.throw?.bind(ctx.source),
        },
        operators: [
          createOperator("multiply", (source) => ({
            async next() {
              const result = await source.next();
              return result.done
                ? result
                : { done: false, value: (result.value as number) * 2 };
            },
            return: source.return?.bind(source),
            throw: source.throw?.bind(source),
          })),
        ],
        final: (iterator) => ({
          async next() {
            const result = await iterator.next();
            return result.done
              ? result
              : { done: false, value: (result.value as number) - 1 };
          },
          return: iterator.return?.bind(iterator),
          throw: iterator.throw?.bind(iterator),
        }),
      }),
    });

    const source = (async function* () {
      yield 1;
      yield 2;
    })();

    const ctx = {
      streamId: "str-hook-tests",
      subscriptionId: "sub-hook-tests",
      source,
      operators: [],
    };

    const iterator = applyPipeStreamHooks(ctx);
    const collected: number[] = [];

    for (;;) {
      const result = await iterator.next();
      if (result.done) break;
      collected.push(result.value);
    }

    expect(collected).toEqual([
      (1 + 1) * 2 - 1,
      (2 + 1) * 2 - 1,
    ]);
  });
});
