import {
  createAsyncGenerator,
  createPipelineContext,
  createReceiver,
  createStreamContext,
  createSubscription,
  eachValueFrom,
  firstValueFrom,
  LogLevel,
  Operator,
  PipelineContext,
  Stream,
  Subscription,
} from "@actioncrew/streamix";

export interface InspectableStream<T = any> extends Stream<T> {
  pipe<S>(...operators: Operator<T, S>[]): InspectableStream<S>;
  readonly context: PipelineContext;
}

/**
 * Wrap a stream to make it "inspectable".
 * All operators will receive a proper PipelineContext and StreamContext.
 */
export function inspectable<T>(source: Stream<T>): InspectableStream<T> {
  // One PipelineContext for the entire source pipeline
  const pipelineContext = createPipelineContext({
    logLevel: LogLevel.INFO,
    phantomHandler: (operator, streamContext, value) => {
      const result = streamContext.createResult({ value, type: 'phantom' });
      streamContext.logFlow('phantom', operator, result, 'Phantom value dropped');
    },
  });

  // Root StreamContext for the source stream itself
  const rootContext = createStreamContext(pipelineContext, source);

  // Helper to register operator with context
  function registerOperator<T, R>(op: Operator<T, R>, ctx: PipelineContext): void {
    if (!ctx.operators.includes(op)) {
      ctx.operators.push(op);
    }
  }

  // Create a no-op operator for logging when there are no operators
  const noopOperator: Operator = {
    name: 'noop',
    type: 'operator',
    apply: (source) => source
  };

  function createInspectableStream<S>(
    upstream: Stream<any>,
    operators: Operator<any, any>[],
    parentContext: PipelineContext
  ): InspectableStream<S> {
    const streamContext = createStreamContext(parentContext, upstream);

    const pipedStream: InspectableStream<S> = {
      name: `${upstream.name}-sink`,
      type: "stream",
      context: parentContext,

      [Symbol.asyncIterator](): AsyncGenerator<S> {
        return createAsyncGenerator<S>(cb => pipedStream.subscribe(cb));
      },

      pipe<U>(...nextOps: Operator<S, U>[]): InspectableStream<U> {
        return createInspectableStream<U>(pipedStream, nextOps, parentContext);
      },

      subscribe(cb?: any): Subscription {
        const receiver = createReceiver(cb);
        let iterator: AsyncIterator<any> = eachValueFrom(upstream);

        // Register and apply operators
        for (const op of operators) {
          registerOperator(op, parentContext);
          iterator = op.apply(iterator);
        }

        const abortController = new AbortController();
        const { signal } = abortController;

        const abortPromise = new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });

        (async () => {
          try {
            while (true) {
              const winner = await Promise.race([
                abortPromise.then(() => ({ aborted: true } as const)),
                iterator.next().then((result: IteratorResult<any>) => ({ result })),
              ]);

              if ("aborted" in winner || signal.aborted) break;

              const { result } = winner;
              if (result.done) break;

              const streamResult = streamContext.createResult({ value: result.value });
              const lastOp = operators.length > 0 ? operators[operators.length - 1] : noopOperator;
              streamContext.logFlow('resolved', lastOp, streamResult, 'Emitted value');

              await receiver.next?.(result.value);
            }
          } catch (err: any) {
            const lastOp = operators.length > 0 ? operators[operators.length - 1] : noopOperator;
            streamContext.logFlow('error', lastOp, undefined, String(err));
            await receiver.error?.(err);
          } finally {
            await receiver.complete?.();
            await streamContext.finalize();
            parentContext.unregisterStream(streamContext.streamId);
          }
        })();

        return createSubscription(async () => {
          abortController.abort();
          if (iterator.return) {
            await iterator.return().catch(() => {});
          }
        });
      },

      async query(): Promise<S> {
        return firstValueFrom(pipedStream) as Promise<S>;
      },
    };

    return pipedStream;
  }

  const decorated: InspectableStream<T> = {
    ...source,
    context: pipelineContext,

    [Symbol.asyncIterator](): AsyncGenerator<T> {
      return createAsyncGenerator<T>(cb => decorated.subscribe(cb));
    },

    pipe<S>(...operators: Operator<T, S>[]): InspectableStream<S> {
      return createInspectableStream<S>(source, operators, pipelineContext);
    },

    subscribe(cb?: any): Subscription {
      const receiver = createReceiver(cb);
      let iterator: AsyncIterator<T> = eachValueFrom(source);

      const abortController = new AbortController();
      const { signal } = abortController;

      const abortPromise = new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });

      (async () => {
        try {
          while (true) {
            const winner = await Promise.race([
              abortPromise.then(() => ({ aborted: true } as const)),
              iterator.next().then((result: IteratorResult<T>) => ({ result })),
            ]);

            if ("aborted" in winner || signal.aborted) break;

            const { result } = winner;
            if (result.done) break;

            const streamResult = rootContext.createResult({ value: result.value });
            rootContext.logFlow('resolved', noopOperator, streamResult, 'Emitted value');

            await receiver.next?.(result.value);
          }
        } catch (err: any) {
          rootContext.logFlow('error', noopOperator, undefined, String(err));
          await receiver.error?.(err);
        } finally {
          await receiver.complete?.();
          await rootContext.finalize();
          pipelineContext.unregisterStream(rootContext.streamId);
        }
      })();

      return createSubscription(async () => {
        abortController.abort();
        if (iterator.return) {
          await iterator.return().catch(() => {});
        }
      });
    },

    query(): Promise<T> {
      return firstValueFrom(source);
    },
  };

  return decorated;
}
