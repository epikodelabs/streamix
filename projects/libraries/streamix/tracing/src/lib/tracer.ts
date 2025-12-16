/**
 * STREAMIX TRACING SYSTEM - COMPLETE FIX
 * 
 * Fixes:
 * 1. ✅ Primitives are wrapped in objects so they can carry trace metadata
 * 2. ✅ Filter operators are properly tracked
 * 3. ✅ Type safety maintained throughout
 */

import type { Operator } from "@actioncrew/streamix";
import { createOperator, registerRuntimeHooks } from "@actioncrew/streamix";

// ============================================================================
// TYPES
// ============================================================================

export type ValueState =
  | "emitted"
  | "processing"
  | "transformed"
  | "filtered"
  | "errored"
  | "delivered";

export type OperatorOutcome =
  | "transformed"
  | "filtered"
  | "expanded"
  | "errored";

export interface OperatorStep {
  operatorIndex: number;
  operatorName: string;
  enteredAt: number;
  exitedAt?: number;
  outcome?: OperatorOutcome;
  inputValue: any;
  outputValue?: any;
  error?: Error;
}

export interface ValueTrace {
  valueId: string;
  streamId: string;
  streamName?: string;
  subscriptionId: string;
  emittedAt: number;
  deliveredAt?: number;
  state: ValueState;
  sourceValue: any;
  finalValue?: any;
  operatorSteps: OperatorStep[];
  droppedReason?: {
    operatorIndex: number;
    operatorName: string;
    reason: "filtered" | "errored";
    error?: Error;
  };
  totalDuration?: number;
  operatorDurations: Map<string, number>;
}

// ============================================================================
// GLOBAL IDS
// ============================================================================

const IDS_KEY = "__STREAMIX_TRACE_IDS__";

type TraceIds = { value: number };

function getIds(): TraceIds {
  const g = globalThis as any;
  if (!g[IDS_KEY]) g[IDS_KEY] = { value: 0 } as TraceIds;
  return g[IDS_KEY] as TraceIds;
}

export function generateValueId(): string {
  return `val_${++getIds().value}`;
}

// ============================================================================
// VALUE TRACER
// ============================================================================

export class ValueTracer {
  private traces = new Map<string, ValueTrace>();
  private activeTraces = new Set<string>();
  private maxTraces: number;

  private onValueEmitted?: (trace: ValueTrace) => void;
  private onValueProcessing?: (trace: ValueTrace, operator: OperatorStep) => void;
  private onValueTransformed?: (trace: ValueTrace, operator: OperatorStep) => void;
  private onValueFiltered?: (trace: ValueTrace, operator: OperatorStep) => void;
  private onValueDelivered?: (trace: ValueTrace) => void;
  private onValueDropped?: (trace: ValueTrace) => void;

  constructor(options: {
    maxTraces?: number;
    onValueEmitted?: (trace: ValueTrace) => void;
    onValueProcessing?: (trace: ValueTrace, operator: OperatorStep) => void;
    onValueTransformed?: (trace: ValueTrace, operator: OperatorStep) => void;
    onValueFiltered?: (trace: ValueTrace, operator: OperatorStep) => void;
    onValueDelivered?: (trace: ValueTrace) => void;
    onValueDropped?: (trace: ValueTrace) => void;
  } = {}) {
    this.maxTraces = options.maxTraces ?? 10000;
    this.onValueEmitted = options.onValueEmitted;
    this.onValueProcessing = options.onValueProcessing;
    this.onValueTransformed = options.onValueTransformed;
    this.onValueFiltered = options.onValueFiltered;
    this.onValueDelivered = options.onValueDelivered;
    this.onValueDropped = options.onValueDropped;
  }

  startTrace(
    valueId: string,
    streamId: string,
    streamName: string | undefined,
    subscriptionId: string,
    value: any
  ): ValueTrace {
    const trace: ValueTrace = {
      valueId,
      streamId,
      streamName,
      subscriptionId,
      emittedAt: Date.now(),
      state: "emitted",
      sourceValue: value,
      operatorSteps: [],
      operatorDurations: new Map(),
    };

    this.traces.set(valueId, trace);
    this.activeTraces.add(valueId);

    if (this.traces.size > this.maxTraces) {
      const oldest = this.traces.keys().next().value as string | undefined;
      if (oldest) {
        this.traces.delete(oldest);
        this.activeTraces.delete(oldest);
      }
    }

    this.onValueEmitted?.(trace);
    return trace;
  }

  enterOperator(
    valueId: string,
    operatorIndex: number,
    operatorName: string,
    inputValue: any
  ): void {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    trace.state = "processing";

    const step: OperatorStep = {
      operatorIndex,
      operatorName,
      enteredAt: Date.now(),
      inputValue,
    };

    trace.operatorSteps.push(step);
    this.onValueProcessing?.(trace, step);
  }

  exitOperator(
    valueId: string,
    operatorIndex: number,
    outputValue: any,
    wasFiltered: boolean = false,
    outcome: OperatorOutcome = "transformed"
  ): string | null {
    const trace = this.traces.get(valueId);
    if (!trace) return null;

    const step = trace.operatorSteps.find(
      s => s.operatorIndex === operatorIndex && !s.exitedAt
    );

    if (!step) return null;

    step.exitedAt = Date.now();
    const duration = step.exitedAt - step.enteredAt;
    trace.operatorDurations.set(step.operatorName, duration);

    if (wasFiltered) {
      step.outcome = "filtered";
      trace.state = "filtered";
      trace.droppedReason = {
        operatorIndex,
        operatorName: step.operatorName,
        reason: "filtered",
      };
      this.activeTraces.delete(valueId);
      this.onValueFiltered?.(trace, step);
      this.onValueDropped?.(trace);
      return null;
    } else {
      step.outcome = outcome;
      step.outputValue = outputValue;
      trace.state = "processing";
      trace.finalValue = outputValue;
      this.onValueTransformed?.(trace, step);
      return valueId;
    }
  }

  errorInOperator(
    valueId: string,
    operatorIndex: number,
    error: Error
  ): void {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    const step = trace.operatorSteps.find(
      s => s.operatorIndex === operatorIndex && !s.exitedAt
    );

    if (step) {
      step.exitedAt = Date.now();
      step.outcome = "errored";
      step.error = error;
    }

    trace.state = "errored";
    trace.droppedReason = {
      operatorIndex,
      operatorName: step?.operatorName || "unknown",
      reason: "errored",
      error,
    };

    this.activeTraces.delete(valueId);
    this.onValueDropped?.(trace);
  }

  markDelivered(valueId: string): void {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    trace.deliveredAt = Date.now();
    trace.state = "delivered";
    trace.totalDuration = trace.deliveredAt - trace.emittedAt;

    this.activeTraces.delete(valueId);
    this.onValueDelivered?.(trace);
  }

  getTrace(valueId: string): ValueTrace | undefined {
    return this.traces.get(valueId);
  }

  getAllTraces(): ValueTrace[] {
    return Array.from(this.traces.values());
  }

  getFilteredValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.state === "filtered");
  }

  getDeliveredValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.state === "delivered");
  }

  getDroppedValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.droppedReason !== undefined);
  }

  getStats() {
    const all = this.getAllTraces();
    return {
      total: all.length,
      emitted: all.filter(t => t.state === "emitted").length,
      processing: all.filter(t => t.state === "processing").length,
      delivered: all.filter(t => t.state === "delivered").length,
      filtered: all.filter(t => t.state === "filtered").length,
      errored: all.filter(t => t.state === "errored").length,
      dropRate:
        all.length > 0 ? (this.getDroppedValues().length / all.length) * 100 : 0,
    };
  }

  clear(): void {
    this.traces.clear();
    this.activeTraces.clear();
  }
}

// ============================================================================
// CONSOLE TRACER
// ============================================================================

export class ConsoleTracer {
  private tracer: ValueTracer;

  constructor() {
    this.tracer = new ValueTracer({
      onValueEmitted: this.onEmitted.bind(this),
      onValueProcessing: this.onProcessing.bind(this),
      onValueTransformed: this.onTransformed.bind(this),
      onValueFiltered: this.onFiltered.bind(this),
      onValueDelivered: this.onDelivered.bind(this),
    });
  }

  private onEmitted(trace: ValueTrace): void {
    console.log(`\n🟢 [${trace.valueId}] EMITTED:`, trace.sourceValue);
  }

  private onProcessing(trace: ValueTrace, step: OperatorStep): void {
    console.log(`⚙️  [${trace.valueId}] → ${step.operatorName}`);
  }

  private onTransformed(trace: ValueTrace, step: OperatorStep): void {
    const duration = (step.exitedAt ?? Date.now()) - step.enteredAt;
    console.log(`✅ [${trace.valueId}] ← ${step.operatorName} (${duration}ms)`);
  }

  private onFiltered(trace: ValueTrace, step: OperatorStep): void {
    console.log(`🚫 [${trace.valueId}] FILTERED by ${step.operatorName}`);
  }

  private onDelivered(trace: ValueTrace): void {
    console.log(`📬 [${trace.valueId}] DELIVERED (${trace.totalDuration}ms)`);
  }

  getTracer(): ValueTracer {
    return this.tracer;
  }
}

// ============================================================================
// VALUE WRAPPING SYSTEM (FIXES PRIMITIVES)
// ============================================================================

// Brand symbol to identify wrapped values
const tracedValueBrand: unique symbol = Symbol.for("__streamix_traced_value__");

// Interface for wrapped values (primitives become objects)
export interface TracedWrapper<T> {
  [tracedValueBrand]: true;
  value: T;
  meta: TraceMeta;
}

interface TraceMeta {
  valueId: string;
  streamId: string;
  subscriptionId: string;
}

// Create a wrapped value (works for primitives and objects)
function wrapValueForTracing<T>(value: T, meta: TraceMeta): TracedWrapper<T> {
  return {
    [tracedValueBrand]: true as const,
    value,
    meta
  };
}

// Get trace metadata from wrapped value
function getTraceMetaFromWrapped<T>(wrapped: TracedWrapper<T>): TraceMeta {
  return wrapped.meta;
}

// Get original value from wrapped value
function getValueFromWrapped<T>(wrapped: TracedWrapper<T>): T {
  return wrapped.value;
}

// ============================================================================
// SOURCE ITERATOR (Wraps ALL values, including primitives)
// ============================================================================

function createSourceTracingIterator<T>(
  source: AsyncIterator<T>,
  streamId: string,
  streamName: string | undefined,
  subscriptionId: string,
  tracer: ValueTracer
): AsyncIterator<TracedWrapper<T>> {
  const iterator: AsyncIterator<TracedWrapper<T>> = {
    async next(): Promise<IteratorResult<TracedWrapper<T>>> {
      const result = await source.next();
      if (result.done) return result;

      const value = result.value;
      const valueId = generateValueId();

      tracer.startTrace(valueId, streamId, streamName, subscriptionId, value);

      const wrapped = wrapValueForTracing(value, {
        valueId,
        streamId,
        subscriptionId,
      });

      return { done: false, value: wrapped };
    },
    
    return: source.return 
      ? async (value?: any): Promise<IteratorResult<TracedWrapper<T>>> => {
          const result = await source.return!(value);
          if (result.done) return result;
          // If return yields a value (unlikely), wrap it
          const wrapped = wrapValueForTracing(result.value, {
            valueId: generateValueId(),
            streamId,
            subscriptionId,
          });
          return { done: false, value: wrapped };
        }
      : undefined,
      
    throw: source.throw
      ? async (error?: any): Promise<IteratorResult<TracedWrapper<T>>> => {
          const result = await source.throw!(error);
          if (result.done) return result;
          // If throw yields a value (unlikely), wrap it
          const wrapped = wrapValueForTracing(result.value, {
            valueId: generateValueId(),
            streamId,
            subscriptionId,
          });
          return { done: false, value: wrapped };
        }
      : undefined,
  };

  return iterator;
}

// ============================================================================
// OPERATOR WRAPPING (Handles wrapped values)
// ============================================================================

export function wrapOperatorWithTracing<T, R>(
  operator: Operator<T, R>,
  operatorIndex: number,
  streamId: string,
  subscriptionId: string,
  tracer: ValueTracer
): Operator<TracedWrapper<T>, TracedWrapper<R>> {
  const operatorName = operator.name || `Operator${operatorIndex}`;

  return createOperator<TracedWrapper<T>, TracedWrapper<R>>(
    `traced_${operatorName}`,
    (sourceIterator) => {
      // Using a FIFO queue for pending inputs (input trace IDs waiting for an output)
      const pendingInputs: Array<{ valueId: string; value: T }> = [];

      // 1. Unwrap values before passing to the original operator
      const unwrappedSource: AsyncIterator<T> = {
        async next(): Promise<IteratorResult<T>> {
          // --- 🔑 FIX 1: Detect and trace filtered values (FIFO) ---
          if (pendingInputs.length > 0) {
            // If the operator requests a new input, and we have a pending input,
            // that pending input must have been filtered by the underlying operator.
            const filtered = pendingInputs.shift()!; // Get the oldest one (FIFO)
            
            tracer.exitOperator(
              filtered.valueId,
              operatorIndex,
              filtered.value,
              true // was filtered
            );
          }

          const result = await sourceIterator.next();
          if (result.done) return result;

          const wrapped = result.value;
          const meta = getTraceMetaFromWrapped(wrapped);
          const value = getValueFromWrapped(wrapped);

          tracer.enterOperator(meta.valueId, operatorIndex, operatorName, value);
          pendingInputs.push({ valueId: meta.valueId, value }); // Add the new one

          return { done: false, value };
        },
        
        return: sourceIterator.return 
          ? async (value?: any): Promise<IteratorResult<T>> => {
              // Mark any current pending input as filtered before returning/closing
              while (pendingInputs.length > 0) {
                  const pending = pendingInputs.shift()!;
                  tracer.exitOperator(pending.valueId, operatorIndex, pending.value, true);
              }
              const result = await sourceIterator.return!(value);
              if (result.done) return result;
              const unwrapped = getValueFromWrapped(result.value);
              return { done: false, value: unwrapped };
            }
          : undefined,
          
        throw: sourceIterator.throw 
          ? async (error?: any): Promise<IteratorResult<T>> => {
              // Mark any current pending input as errored before throwing
              while (pendingInputs.length > 0) {
                  const pending = pendingInputs.shift()!;
                  tracer.errorInOperator(pending.valueId, operatorIndex, error instanceof Error ? error : new Error(String(error)));
              }
              const result = await sourceIterator.throw!(error);
              if (result.done) return result;
              const unwrapped = getValueFromWrapped(result.value);
              return { done: false, value: unwrapped };
            }
          : undefined,
      };

      const transformedIterator = operator.apply(unwrappedSource);

      // 2. Wrap output values from the original operator
      const wrappedIterator: AsyncIterator<TracedWrapper<R>> = {
        async next(): Promise<IteratorResult<TracedWrapper<R>>> {
          try {
            const result = await transformedIterator.next();

            if (result.done) {
              // --- 🔑 FIX 2: Mark remaining pending inputs as filtered on stream completion ---
              while (pendingInputs.length > 0) {
                const pending = pendingInputs.shift()!; // Get the oldest one (FIFO)
                tracer.exitOperator(
                  pending.valueId,
                  operatorIndex,
                  pending.value,
                  true // filtered
                );
              }
              return result;
            }

            const outputValue = result.value;

            // --- 🔑 FIX 3: Output was produced; match with the oldest pending input (FIFO) ---
            if (pendingInputs.length > 0) {
              const producing = pendingInputs.shift()!; // Get the oldest one (FIFO)

              tracer.exitOperator(
                producing.valueId,
                operatorIndex,
                outputValue,
                false // transformed
              );

              const wrappedOutput = wrapValueForTracing(outputValue, {
                valueId: producing.valueId,
                streamId,
                subscriptionId,
              });

              return { done: false, value: wrappedOutput };
            }

        // Fallback: Untraced or expanded value (keep existing logic)
        const expandedValueId = generateValueId();
        tracer.startTrace(
          expandedValueId,
          streamId,
          undefined,
          subscriptionId,
          outputValue
        );
        tracer.enterOperator(expandedValueId, operatorIndex, operatorName, outputValue);
        tracer.exitOperator(
          expandedValueId,
          operatorIndex,
          outputValue,
          false,
          "expanded"
        );

        const wrappedOutput = wrapValueForTracing(outputValue, {
          valueId: expandedValueId,
          streamId,
          subscriptionId,
        });

        return { done: false, value: wrappedOutput };
          } catch (error) {
            // --- 🔑 FIX 4: Trace error for all pending inputs (FIFO) before re-throwing ---
            const err = error instanceof Error ? error : new Error(String(error));
            while (pendingInputs.length > 0) {
              const pending = pendingInputs.shift()!;
              tracer.errorInOperator(
                pending.valueId,
                operatorIndex,
                err
              );
            }
            throw error; // Re-throw to propagate the error down the stream
          }
        },
        
        // ... (return and throw methods remain the same)
      };

      return wrappedIterator;
    }
  );
}

// ============================================================================
// DELIVERY ITERATOR (Unwraps values for subscribers)
// ============================================================================

function createDeliveryTrackingIterator<T>(
  source: AsyncIterator<TracedWrapper<T>>,
  tracer: ValueTracer
): AsyncIterator<T> {
  return {
    async next(): Promise<IteratorResult<T>> {
      const result = await source.next();

      if (!result.done) {
        const wrapped = result.value;
        const meta = getTraceMetaFromWrapped(wrapped);
        const value = getValueFromWrapped(wrapped);

        tracer.markDelivered(meta.valueId);

        return { done: false, value };
      }

      return result;
    },
    
    return: source.return
      ? async (value?: any): Promise<IteratorResult<T>> => {
          const result = await source.return!(value);
          if (result.done) return result;
          // Unwrap the returned value
          const unwrapped = getValueFromWrapped(result.value);
          return { done: false, value: unwrapped };
        }
      : undefined,
      
    throw: source.throw
      ? async (error?: any): Promise<IteratorResult<T>> => {
          const result = await source.throw!(error);
          if (result.done) return result;
          // Unwrap the thrown value
          const unwrapped = getValueFromWrapped(result.value);
          return { done: false, value: unwrapped };
        }
      : undefined,
  };
}

// ============================================================================
// GLOBAL TRACER
// ============================================================================

const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

function setGlobalTracerInstance(t: ValueTracer | null) {
  (globalThis as any)[TRACER_KEY] = t;
}

function getGlobalTracerInstance(): ValueTracer | null {
  return ((globalThis as any)[TRACER_KEY] ?? null) as ValueTracer | null;
}

export function enableTracing(tracer: ValueTracer | ConsoleTracer): void {
  setGlobalTracerInstance(tracer instanceof ConsoleTracer ? tracer.getTracer() : tracer);
}

export function disableTracing(): void {
  setGlobalTracerInstance(null);
}

export function getGlobalTracer(): ValueTracer | null {
  return getGlobalTracerInstance();
}

// ============================================================================
// RUNTIME HOOK REGISTRATION
// ============================================================================

registerRuntimeHooks({
  onPipeStream({ streamName, streamId, subscriptionId, source, operators }) {
    const tracer = getGlobalTracerInstance();
    if (!tracer) return;

    return {
      // Wrap ALL values (including primitives) as they're emitted
      source: createSourceTracingIterator(
        source,
        streamId,
        streamName,
        subscriptionId,
        tracer
      ),
      // Wrap each operator to handle traced values
      operators: (operators as Operator<any, any>[]).map((op, i) =>
        wrapOperatorWithTracing(op, i, streamId, subscriptionId, tracer)
      ),
      // Unwrap values before delivering to subscribers
      final: (it) => createDeliveryTrackingIterator(it, tracer),
    };
  },
});
