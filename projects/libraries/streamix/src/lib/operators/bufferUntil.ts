import {
  createMultiSourceRunner,
  createOperator,
  DONE,
  getIteratorEmissionStamp,
  getIteratorMeta,
  nextEmissionStamp,
  setIteratorEmissionStamp,
  setIteratorMeta,
  setValueMeta,
  type Operator,
  type Stream,
} from "../abstractions";
import { fromAny } from "../converters";

export const bufferUntil = <T = any>(notifier: Stream<any>) =>
  createOperator<T, T[]>("bufferUntil", function (this: Operator, source: AsyncIterator<T>) {
    const notifierIt = fromAny(notifier)[Symbol.asyncIterator]();
    const runner = createMultiSourceRunner([source, notifierIt]);

    let buffer: T[] = [];
    let bufferMetas: Array<{
      valueId: string;
      operatorIndex: number;
      operatorName: string;
      stamp: number;
    }> = [];
    let cancelled = false;

    const flushBuffer = (): IteratorResult<T[]> => {
      if (buffer.length === 0) return DONE;

      const values = [...buffer];
      const metas = [...bufferMetas];
      buffer = [];
      bufferMetas = [];

      if (metas.length > 0) {
        const lastMeta = metas[metas.length - 1];
        const collapseMeta = {
          valueId: lastMeta.valueId,
          kind: "collapse" as const,
          inputValueIds: metas.map(m => m.valueId),
        };

        setIteratorMeta(iterator as any, collapseMeta, lastMeta.operatorIndex, lastMeta.operatorName);
        const taggedValues = setValueMeta(values, collapseMeta, lastMeta.operatorIndex, lastMeta.operatorName);
        
        const lastStamp = lastMeta.stamp;
        setIteratorEmissionStamp(iterator as any, lastStamp);
        
        return { value: taggedValues, done: false };
      } else {
        const lastStamp = getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp();
        setIteratorEmissionStamp(iterator as any, lastStamp);
        return { value: values, done: false };
      }
    };

    const iterator: AsyncIterator<T[]> & {
      __tryNext?: () => IteratorResult<T[]> | null;
      __hasBufferedValues?: () => boolean;
    } = {
      async next() {
        while (true) {
          if (cancelled) return DONE;
          
          const runnerResult = await runner.next();
          
          if (runnerResult.done) {
            // All sources completed
            return flushBuffer();
          }

          const event = runnerResult.value;
          
          switch (event.type) {
            case 'value':
              if (event.sourceIndex === 0) {
                // Source value - add to buffer
                buffer.push(event.value as T);
                
                // Capture metadata if available
                const meta = getIteratorMeta(runner as any);
                if (meta) {
                  bufferMetas.push({
                    valueId: meta.valueId,
                    operatorIndex: meta.operatorIndex,
                    operatorName: meta.operatorName,
                    stamp: getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp(),
                  });
                }
              } else {
                // Notifier value - flush buffer
                if (buffer.length > 0) {
                  return flushBuffer();
                }
                // Empty buffer, continue
              }
              break;
              
            case 'complete':
              if (event.sourceIndex === 0) {
                // Source completed - flush buffer if any
                if (buffer.length > 0) {
                  return flushBuffer();
                }
                // Source completed with empty buffer
                // Continue to wait for notifier or runner completion
              }
              break;
              
            case 'error':
              // Propagate error and ensure notifier is cancelled
              cancelled = true;
              try {
                await notifierIt.return?.();
              } catch {}
              throw event.error;
          }
        }
      },

      async return(value?: any) {
        if (cancelled) return value !== undefined ? { value, done: true } : DONE;
        cancelled = true;
        try {
          await runner.return?.();
          await notifierIt.return?.();
        } catch {}
        return value !== undefined ? { value, done: true } : DONE;
      },

      async throw(err?: any) {
        if (cancelled) return Promise.reject(err);
        cancelled = true;
        try {
          await runner.throw?.(err);
          await notifierIt.return?.();
        } catch {}
        return Promise.reject(err);
      },

      __tryNext: () => {
        if (cancelled) return DONE;
        if (!runner.__tryNext) return null;
        
        while (true) {
          const runnerResult = runner.__tryNext();
          if (!runnerResult) return null;
          
          if (runnerResult.done) {
            // All sources completed
            return flushBuffer();
          }

          const event = runnerResult.value;
          
          switch (event.type) {
            case 'value':
              if (event.sourceIndex === 0) {
                // Source value
                buffer.push(event.value as T);
                
                // Capture metadata if available
                const meta = getIteratorMeta(runner as any);
                if (meta) {
                  bufferMetas.push({
                    valueId: meta.valueId,
                    operatorIndex: meta.operatorIndex,
                    operatorName: meta.operatorName,
                    stamp: getIteratorEmissionStamp(runner as any) ?? nextEmissionStamp(),
                  });
                }
              } else {
                // Notifier
                if (buffer.length > 0) {
                  return flushBuffer();
                }
              }
              break;
              
            case 'complete':
              if (event.sourceIndex === 0 && buffer.length > 0) {
                return flushBuffer();
              }
              break;
              
            case 'error':
              // Cancel notifier and throw error synchronously
              cancelled = true;
              notifierIt.return?.().catch(() => {});
              throw event.error;
          }
        }
      },

      __hasBufferedValues: () => {
        return buffer.length > 0 || (runner.__hasBufferedValues ? runner.__hasBufferedValues() : false);
      }
    };

    return iterator;
  });