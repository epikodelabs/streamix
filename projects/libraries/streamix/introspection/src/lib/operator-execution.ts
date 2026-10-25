import { __streamixRuntime as internalRuntime, isRuntimeInstrumentationEnabled, installStreamixOperatorTracking, type ExecutionSpan, type RuntimeOrigin } from '@epikodelabs/streamix';
// Evaluating the rest of the introspection entry is part of this module's install.
import './introspection';

/**
 * Observe an operator iterator without changing its pull/push contract.
 * Execution begins at the first pull, not when the operator is composed.
 * In-place instrumentation preserves __tryNext, __onPush and other iterator hooks.
 * The optional name and origin label the execution record for runtime diagnostics.
 */
export function trackOperatorExecution<T>(iterator: AsyncIterator<T>, name?: string, origin?: RuntimeOrigin): AsyncIterator<T> {
  if (!isRuntimeInstrumentationEnabled() && !internalRuntime.events.observed) return iterator;
  const node = iterator as object;
  const next = iterator.next.bind(iterator);
  const originalReturn = iterator.return?.bind(iterator);
  const originalThrow = iterator.throw?.bind(iterator);
  let span: ExecutionSpan | undefined;
  let finished = false;

  const start = () => {
    if (span === undefined && !finished) span = internalRuntime.beginExecution(node, name, origin);
  };
  const finish = (kind: 'complete' | 'cancel' | 'error', error?: unknown) => {
    if (finished) return;
    finished = true;
    const active = span;
    span = undefined;
    if (active === undefined) return;
    active.finish(kind, error);
    // Operator iterators are one-shot: keep their diagnostics record only while active.
    internalRuntime.diagnostics.executions.forget(node);
  };
  const accept = (result: IteratorResult<T>, requestedAt?: number): IteratorResult<T> => {
    if (result.done) finish('complete');
    else if (!finished && span !== undefined) span.next(result.value, requestedAt);
    return result;
  };
  const fail = (error: unknown): never => { finish('error', error); throw error; };
  const observe = (result: IteratorResult<T> | PromiseLike<IteratorResult<T>>, requestedAt?: number): any => {
    if (result && typeof (result as any).then === 'function') {
      return Promise.resolve(result).then(value => accept(value, requestedAt), fail);
    }
    return accept(result as IteratorResult<T>, requestedAt);
  };

  iterator.next = ((...args: any[]) => {
    start();
    const requestedAt = span?.reports === true ? performance.now() : undefined;
    try { return observe((next as any)(...args), requestedAt); }
    catch (error) { return fail(error); }
  }) as typeof iterator.next;

  if (originalReturn) {
    iterator.return = ((...args: any[]) => {
      // Cancellation is effective as soon as return() is requested. An async
      // iterator may keep its cleanup promise pending indefinitely; metrics
      // and late next() results must not remain active while it settles.
      finish('cancel');
      try {
        return (originalReturn as any)(...args);
      } catch (error) {
        // The execution has already been cancelled; preserve the original
        // exception for the caller without recording a second terminal event.
        throw error;
      }
    }) as typeof iterator.return;
  }
  if (originalThrow) {
    iterator.throw = ((error: unknown) => {
      try {
        const result = originalThrow(error);
        if (result && typeof (result as any).then === 'function') {
          return Promise.resolve(result).then((value: IteratorResult<T>) => {
            if (value.done) finish('complete');
            return value;
          }, fail);
        }
        if ((result as unknown as IteratorResult<T>).done) finish('complete');
        return result;
      } catch (caught) { return fail(caught); }
    }) as typeof iterator.throw;
  }
  return iterator;
}

// Self-install: evaluating this module swaps the core's pass-through
// trackOperatorExecution stub for the real accounting wrapper. Lives at
// module scope (not in the entry facade) because bundlers may flatten
// re-export facades and skip their side effects.
installStreamixOperatorTracking(trackOperatorExecution);
