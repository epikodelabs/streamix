import { Stream, createOperator, createPipelineContext, createStreamContext, LogLevel } from '@actioncrew/streamix';

describe('context', () => {
  it('tracks register/unregister lifecycle', async () => {
    const operator = createOperator('noop', (iter) => iter);
    const pipeline = createPipelineContext({ logLevel: LogLevel.OFF });
    pipeline.operators = [operator];

    const dummyStream: Stream<any> = { name: 's', type: 'stream', pipe: () => dummyStream as any, subscribe: () => ({ unsubscribed: false, unsubscribe() {} }), query: async () => undefined, [Symbol.asyncIterator]: async function* () { } } as any;

    const ctx = createStreamContext(pipeline, dummyStream);
    expect(pipeline.activeStreams.has(ctx.streamId)).toBeTrue();

    pipeline.unregisterStream(ctx.streamId);
    expect(pipeline.activeStreams.has(ctx.streamId)).toBeFalse();
  });

  it('finalizes pending results', async () => {
    const operator = createOperator('noop', (iter) => iter);
    const pipeline = createPipelineContext({ logLevel: LogLevel.OFF });
    pipeline.operators = [operator];

    const dummyStream: Stream<any> = { name: 's', type: 'stream', pipe: () => dummyStream as any, subscribe: () => ({ unsubscribed: false, unsubscribe() {} }), query: async () => undefined, [Symbol.asyncIterator]: async function* () { } } as any;
    const ctx = createStreamContext(pipeline, dummyStream);

    const result = ctx.createResult();
    ctx.markPending(operator, result);
    await ctx.resolvePending(operator, result);

    await ctx.finalize();
    pipeline.unregisterStream(ctx.streamId);
    expect(ctx.pendingResults.size).toBe(0);
  });
});
