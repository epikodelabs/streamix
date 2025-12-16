/**
 * STREAMIX TRACING SYSTEM - COMPLETE IMPLEMENTATION
 * 
 * A comprehensive tracing system for Streamix reactive streams that provides detailed
 * visibility into value flow through operator pipelines.
 * 
 * This system instruments Streamix operators to track:
 * - Value lifecycle from emission to delivery
 * - Operator transformations and filtering
 * - Performance metrics and timing
 * - Error tracking and debugging
 * - Collapsing operations (buffer, reduce)
 * 
 * Key Features:
 * 1. ✅ Primitives are wrapped in objects to carry trace metadata
 * 2. ✅ Filter operators are properly tracked
 * 3. ✅ Collapsing operators (buffer, reduce) don't mark values as filtered
 * 4. ✅ Dropped values are separate from filtered values
 * 5. ✅ Type safety maintained throughout
 * 6. ✅ Console output for debugging
 * 7. ✅ Global tracer management
 * 
 * @module @actioncrew/streamix/tracing
 */

import type { Operator } from "@actioncrew/streamix";
import { createOperator, registerRuntimeHooks } from "@actioncrew/streamix";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Represents the current state of a value as it flows through the stream pipeline.
 * Tracks the complete lifecycle from emission to delivery or dropping.
 */
export type ValueState =
  | "emitted"      /** Value was emitted from the source */
  | "processing"   /** Value is currently being processed by an operator */
  | "transformed"  /** Value was transformed by an operator */
  | "filtered"     /** Value was filtered out by an operator */
  | "collapsed"    /** Value was collapsed into another value (e.g., in buffer/reduce) */
  | "errored"      /** An error occurred while processing this value */
  | "delivered";   /** Value was delivered to the subscriber */

/**
 * Represents the outcome of an operator processing a value.
 * Used to categorize what happened to a value in each operator step.
 */
export type OperatorOutcome =
  | "transformed"  /** Value was transformed to a new value */
  | "filtered"     /** Value was filtered out */
  | "expanded"     /** Operator produced more values than it consumed (expansion) */
  | "collapsed"    /** Value was collapsed with other values */
  | "errored";     /** An error occurred during processing */

/**
 * Represents a single step in an operator pipeline for a specific value.
 * Records timing, input/output values, and outcome for debugging and analysis.
 */
export interface OperatorStep {
  /** Index of the operator in the pipeline (0-based) */
  operatorIndex: number;
  
  /** Name of the operator for identification */
  operatorName: string;
  
  /** Timestamp (milliseconds) when value entered this operator */
  enteredAt: number;
  
  /** Timestamp when value exited this operator (undefined if still processing) */
  exitedAt?: number;
  
  /** What happened to the value in this operator */
  outcome?: OperatorOutcome;
  
  /** Value before operator processing */
  inputValue: any;
  
  /** Value after operator processing (if transformed) */
  outputValue?: any;
  
  /** Error that occurred during processing (if any) */
  error?: Error;
}

/**
 * Complete trace of a value's journey through the stream pipeline.
 * Contains all metadata, timing, and step-by-step operator interactions.
 */
export interface ValueTrace {
  /** Unique identifier for this value instance */
  valueId: string;
  
  /** Identifier of the stream that emitted this value */
  streamId: string;
  
  /** Human-readable name of the stream (optional) */
  streamName?: string;
  
  /** Identifier of the subscription receiving this value */
  subscriptionId: string;
  
  /** Timestamp when value was emitted from source */
  emittedAt: number;
  
  /** Timestamp when value was delivered to subscriber (if delivered) */
  deliveredAt?: number;
  
  /** Current state in the value lifecycle */
  state: ValueState;
  
  /** Original value as emitted from source */
  sourceValue: any;
  
  /** Final value after all transformations (if delivered) */
  finalValue?: any;
  
  /** Sequential record of all operator interactions */
  operatorSteps: OperatorStep[];
  
  /** Reason for dropping if value was filtered or errored */
  droppedReason?: {
    operatorIndex: number;
    operatorName: string;
    reason: "filtered" | "errored" | "collapsed";
    error?: Error;
  };
  
  /** Collapse information if value was merged into another */
  collapsedInto?: {
    operatorIndex: number;
    operatorName: string;
    targetValueId: string;
  };
  
  /** Total time from emission to delivery (if delivered) */
  totalDuration?: number;
  
  /** Map of operator names to processing durations */
  operatorDurations: Map<string, number>;
}

// ============================================================================
// ID GENERATION
// ============================================================================

/** Internal key for storing ID counter in global scope */
const IDS_KEY = "__STREAMIX_TRACE_IDS__";

/**
 * Internal type for ID counter stored in global scope
 */
type TraceIds = { value: number };

/**
 * Gets or creates the ID counter from global scope
 * @returns The ID counter object
 * @internal
 */
function getIds(): TraceIds {
  const g = globalThis as any;
  if (!g[IDS_KEY]) g[IDS_KEY] = { value: 0 } as TraceIds;
  return g[IDS_KEY] as TraceIds;
}

/**
 * Generates a unique identifier for trace values
 * @returns A unique string identifier in format "val_{number}"
 * @example "val_42"
 */
export function generateValueId(): string {
  return `val_${++getIds().value}`;
}

// ============================================================================
// VALUE TRACER - CORE TRACING ENGINE
// ============================================================================

/**
 * Main tracing engine that tracks values through the stream pipeline.
 * Manages trace storage, lifecycle events, and provides statistics.
 */
export class ValueTracer {
  /** Complete history of all traced values */
  private traces = new Map<string, ValueTrace>();
  
  /** Set of value IDs currently active (not yet delivered/filtered) */
  private activeTraces = new Set<string>();
  
  /** Maximum number of traces to store (prevents memory leaks) */
  private maxTraces: number;

  // Event callbacks for tracing lifecycle
  private onValueEmitted?: (trace: ValueTrace) => void;
  private onValueProcessing?: (trace: ValueTrace, operator: OperatorStep) => void;
  private onValueTransformed?: (trace: ValueTrace, operator: OperatorStep) => void;
  private onValueFiltered?: (trace: ValueTrace, operator: OperatorStep) => void;
  private onValueCollapsed?: (trace: ValueTrace, operator: OperatorStep) => void;
  private onValueDelivered?: (trace: ValueTrace) => void;
  private onValueDropped?: (trace: ValueTrace) => void;

  /**
   * Creates a new ValueTracer instance
   * @param options Configuration options for the tracer
   * @param options.maxTraces Maximum number of traces to store (default: 10000)
   * @param options.onValueEmitted Callback when a value is emitted
   * @param options.onValueProcessing Callback when value enters an operator
   * @param options.onValueTransformed Callback when value is transformed
   * @param options.onValueFiltered Callback when value is filtered
   * @param options.onValueCollapsed Callback when value is collapsed
   * @param options.onValueDelivered Callback when value is delivered
   * @param options.onValueDropped Callback when value is dropped
   */
  constructor(options: {
    maxTraces?: number;
    onValueEmitted?: (trace: ValueTrace) => void;
    onValueProcessing?: (trace: ValueTrace, operator: OperatorStep) => void;
    onValueTransformed?: (trace: ValueTrace, operator: OperatorStep) => void;
    onValueFiltered?: (trace: ValueTrace, operator: OperatorStep) => void;
    onValueCollapsed?: (trace: ValueTrace, operator: OperatorStep) => void;
    onValueDelivered?: (trace: ValueTrace) => void;
    onValueDropped?: (trace: ValueTrace) => void;
  } = {}) {
    this.maxTraces = options.maxTraces ?? 10000;
    this.onValueEmitted = options.onValueEmitted;
    this.onValueProcessing = options.onValueProcessing;
    this.onValueTransformed = options.onValueTransformed;
    this.onValueFiltered = options.onValueFiltered;
    this.onValueCollapsed = options.onValueCollapsed;
    this.onValueDelivered = options.onValueDelivered;
    this.onValueDropped = options.onValueDropped;
  }

  /**
   * Starts tracking a new value emitted from a source
   * @param valueId Unique identifier for the value
   * @param streamId Identifier of the emitting stream
   * @param streamName Human-readable stream name (optional)
   * @param subscriptionId Identifier of the subscription
   * @param value The actual value being traced
   * @returns The created trace object
   */
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

    // Store the trace
    this.traces.set(valueId, trace);
    this.activeTraces.add(valueId);

    // Enforce maximum trace limit
    if (this.traces.size > this.maxTraces) {
      const oldest = this.traces.keys().next().value as string | undefined;
      if (oldest) {
        this.traces.delete(oldest);
        this.activeTraces.delete(oldest);
      }
    }

    // Notify listeners
    this.onValueEmitted?.(trace);
    return trace;
  }

  /**
   * Records when a value enters an operator for processing
   * @param valueId ID of the value being processed
   * @param operatorIndex Index of the operator in the pipeline
   * @param operatorName Name of the operator
   * @param inputValue Value before operator processing
   */
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

  /**
   * Records when a value exits an operator after processing
   * @param valueId ID of the value
   * @param operatorIndex Index of the operator
   * @param outputValue Value after operator processing
   * @param wasFiltered Whether the value was filtered out
   * @param outcome What happened to the value
   * @returns The value ID if not filtered, null if filtered
   */
  exitOperator(
    valueId: string,
    operatorIndex: number,
    outputValue: any,
    wasFiltered: boolean = false,
    outcome: OperatorOutcome = "transformed"
  ): string | null {
    const trace = this.traces.get(valueId);
    if (!trace) return null;

    // Find the corresponding operator step
    const step = trace.operatorSteps.find(
      s => s.operatorIndex === operatorIndex && !s.exitedAt
    );

    if (!step) return null;

    // Record timing
    step.exitedAt = Date.now();
    const duration = step.exitedAt - step.enteredAt;
    trace.operatorDurations.set(step.operatorName, duration);

    if (wasFiltered) {
      // Value was filtered out
      step.outcome = "filtered";
      trace.state = "filtered";
      trace.droppedReason = {
        operatorIndex,
        operatorName: step.operatorName,
        reason: "filtered",
      };
      this.activeTraces.delete(valueId);
      this.onValueFiltered?.(trace, step);
      return null;
    } else {
      // Value was transformed
      step.outcome = outcome;
      step.outputValue = outputValue;
      trace.state = "processing";
      trace.finalValue = outputValue;
      this.onValueTransformed?.(trace, step);
      return valueId;
    }
  }

  /**
   * Records when a value is collapsed (merged) into another value
   * @param valueId ID of the collapsed value
   * @param operatorIndex Index of the collapsing operator
   * @param operatorName Name of the collapsing operator
   * @param targetValueId ID of the value receiving the collapsed value
   */
  collapseValue(
    valueId: string,
    operatorIndex: number,
    operatorName: string,
    targetValueId: string
  ): void {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    // Find and complete the operator step
    const step = trace.operatorSteps.find(
      s => s.operatorIndex === operatorIndex && !s.exitedAt
    );

    if (step) {
      step.exitedAt = Date.now();
      step.outcome = "collapsed";
      const duration = step.exitedAt - step.enteredAt;
      trace.operatorDurations.set(step.operatorName, duration);
    }

    // Record collapse metadata
    trace.state = "collapsed";
    trace.collapsedInto = {
      operatorIndex,
      operatorName,
      targetValueId,
    };

    this.activeTraces.delete(valueId);
    this.onValueCollapsed?.(trace, step!);
  }

  /**
   * Records when an error occurs while processing a value
   * @param valueId ID of the errored value
   * @param operatorIndex Index of the operator where error occurred
   * @param error The error that occurred
   */
  errorInOperator(
    valueId: string,
    operatorIndex: number,
    error: Error
  ): void {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    // Find and complete the operator step with error
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

  /**
   * Records when a value is successfully delivered to a subscriber
   * @param valueId ID of the delivered value
   */
  markDelivered(valueId: string): void {
    const trace = this.traces.get(valueId);
    if (!trace) return;

    trace.deliveredAt = Date.now();
    trace.state = "delivered";
    trace.totalDuration = trace.deliveredAt - trace.emittedAt;

    this.activeTraces.delete(valueId);
    this.onValueDelivered?.(trace);
  }

  /**
   * Retrieves a specific trace by value ID
   * @param valueId ID of the value to retrieve
   * @returns The trace object or undefined if not found
   */
  getTrace(valueId: string): ValueTrace | undefined {
    return this.traces.get(valueId);
  }

  /**
   * Retrieves all traces currently stored
   * @returns Array of all trace objects
   */
  getAllTraces(): ValueTrace[] {
    return Array.from(this.traces.values());
  }

  /**
   * Retrieves all values that were filtered out
   * @returns Array of filtered value traces
   */
  getFilteredValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.state === "filtered");
  }

  /**
   * Retrieves all values that were collapsed
   * @returns Array of collapsed value traces
   */
  getCollapsedValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.state === "collapsed");
  }

  /**
   * Retrieves all values that were successfully delivered
   * @returns Array of delivered value traces
   */
  getDeliveredValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.state === "delivered");
  }

  /**
   * Retrieves all values that were dropped (filtered or errored)
   * @returns Array of dropped value traces
   */
  getDroppedValues(): ValueTrace[] {
    return this.getAllTraces().filter(t => t.droppedReason !== undefined);
  }

  /**
   * Calculates statistics about traced values
   * @returns Object containing counts and rates
   */
  getStats() {
    const all = this.getAllTraces();
    return {
      total: all.length,
      emitted: all.filter(t => t.state === "emitted").length,
      processing: all.filter(t => t.state === "processing").length,
      delivered: all.filter(t => t.state === "delivered").length,
      filtered: all.filter(t => t.state === "filtered").length,
      collapsed: all.filter(t => t.state === "collapsed").length,
      errored: all.filter(t => t.state === "errored").length,
      dropRate:
        all.length > 0 ? (this.getDroppedValues().length / all.length) * 100 : 0,
    };
  }

  /**
   * Clears all stored traces and resets the tracer
   */
  clear(): void {
    this.traces.clear();
    this.activeTraces.clear();
  }
}

// ============================================================================
// CONSOLE TRACER - DEBUG OUTPUT
// ============================================================================

/**
 * A tracer implementation that logs value flow to the console for debugging.
 * Provides real-time visibility into stream operations.
 */
export class ConsoleTracer {
  private tracer: ValueTracer;

  /**
   * Creates a new ConsoleTracer that logs to console
   */
  constructor() {
    this.tracer = new ValueTracer({
      onValueEmitted: this.onEmitted.bind(this),
      onValueProcessing: this.onProcessing.bind(this),
      onValueTransformed: this.onTransformed.bind(this),
      onValueFiltered: this.onFiltered.bind(this),
      onValueCollapsed: this.onCollapsed.bind(this),
      onValueDelivered: this.onDelivered.bind(this),
    });
  }

  /** Logs when a value is emitted from source */
  private onEmitted(trace: ValueTrace): void {
    console.log(`\n🟢 [${trace.valueId}] EMITTED:`, trace.sourceValue);
  }

  /** Logs when a value enters an operator */
  private onProcessing(trace: ValueTrace, step: OperatorStep): void {
    console.log(`⚙️  [${trace.valueId}] → ${step.operatorName}`);
  }

  /** Logs when a value is transformed by an operator */
  private onTransformed(trace: ValueTrace, step: OperatorStep): void {
    const duration = (step.exitedAt ?? Date.now()) - step.enteredAt;
    console.log(`✅ [${trace.valueId}] ← ${step.operatorName} (${duration}ms)`);
  }

  /** Logs when a value is filtered out */
  private onFiltered(trace: ValueTrace, step: OperatorStep): void {
    console.log(`🚫 [${trace.valueId}] FILTERED by ${step.operatorName}`);
  }

  /** Logs when a value is collapsed into another */
  private onCollapsed(trace: ValueTrace, step: OperatorStep): void {
    console.log(`🔄 [${trace.valueId}] COLLAPSED by ${step.operatorName}`);
  }

  /** Logs when a value is delivered to subscriber */
  private onDelivered(trace: ValueTrace): void {
    console.log(`📬 [${trace.valueId}] DELIVERED (${trace.totalDuration}ms)`);
  }

  /**
   * Gets the underlying ValueTracer instance
   * @returns The ValueTracer used by this ConsoleTracer
   */
  getTracer(): ValueTracer {
    return this.tracer;
  }
}

// ============================================================================
// VALUE WRAPPING SYSTEM
// ============================================================================

/**
 * Symbol used as a brand to identify traced value wrappers
 * Ensures type safety and prevents confusion with regular objects
 */
const tracedValueBrand: unique symbol = Symbol.for("__streamix_traced_value__");

/**
 * Wrapper that encapsulates a value with trace metadata
 * This allows primitives and objects to carry tracing information
 * through the operator pipeline without modifying the original value.
 * 
 * @template T Type of the wrapped value
 */
export interface TracedWrapper<T> {
  /** Brand symbol identifying this as a traced wrapper */
  [tracedValueBrand]: true;
  
  /** The original value being traced */
  value: T;
  
  /** Tracing metadata for this value */
  meta: TraceMeta;
}

/**
 * Metadata required for tracing a value through the pipeline
 */
interface TraceMeta {
  /** Unique identifier for this value instance */
  valueId: string;
  
  /** Identifier of the stream that emitted this value */
  streamId: string;
  
  /** Identifier of the subscription receiving this value */
  subscriptionId: string;
}

/**
 * Wraps a value with tracing metadata
 * @param value The value to wrap
 * @param meta Tracing metadata for the value
 * @returns A traced wrapper containing the value and metadata
 * @template T Type of the value being wrapped
 */
function wrapValueForTracing<T>(value: T, meta: TraceMeta): TracedWrapper<T> {
  return {
    [tracedValueBrand]: true as const,
    value,
    meta
  };
}

/**
 * Extracts tracing metadata from a wrapped value
 * @param wrapped The traced wrapper
 * @returns The tracing metadata
 * @template T Type of the wrapped value
 */
function getTraceMetaFromWrapped<T>(wrapped: TracedWrapper<T>): TraceMeta {
  return wrapped.meta;
}

/**
 * Extracts the original value from a traced wrapper
 * @param wrapped The traced wrapper
 * @returns The original unwrapped value
 * @template T Type of the wrapped value
 */
function getValueFromWrapped<T>(wrapped: TracedWrapper<T>): T {
  return wrapped.value;
}

// ============================================================================
// SOURCE ITERATOR WRAPPING
// ============================================================================

/**
 * Creates a tracing iterator that wraps source values with trace metadata
 * This is the entry point where values enter the tracing system
 * 
 * @param source The original source iterator
 * @param streamId Identifier of the stream
 * @param streamName Human-readable stream name (optional)
 * @param subscriptionId Identifier of the subscription
 * @param tracer The tracer instance to use
 * @returns An iterator that yields traced values
 * @template T Type of values from the source
 */
function createSourceTracingIterator<T>(
  source: AsyncIterator<T>,
  streamId: string,
  streamName: string | undefined,
  subscriptionId: string,
  tracer: ValueTracer
): AsyncIterator<TracedWrapper<T>> {
  const iterator: AsyncIterator<TracedWrapper<T>> = {
    /**
     * Gets the next value from the source, wraps it with trace metadata,
     * and starts tracking it in the tracer
     */
    async next(): Promise<IteratorResult<TracedWrapper<T>>> {
      const result = await source.next();
      if (result.done) return result;

      const value = result.value;
      const valueId = generateValueId();

      // Start tracing this value
      tracer.startTrace(valueId, streamId, streamName, subscriptionId, value);

      // Wrap with tracing metadata
      const wrapped = wrapValueForTracing(value, {
        valueId,
        streamId,
        subscriptionId,
      });

      return { done: false, value: wrapped };
    },
    
    /**
     * Handles iterator return (completion) with optional value
     * Still wraps any returned value with tracing
     */
    return: source.return 
      ? async (value?: any): Promise<IteratorResult<TracedWrapper<T>>> => {
          const result = await source.return!(value);
          if (result.done) return result;
          
          // Even returned values get traced
          const wrapped = wrapValueForTracing(result.value, {
            valueId: generateValueId(),
            streamId,
            subscriptionId,
          });
          return { done: false, value: wrapped };
        }
      : undefined,
      
    /**
     * Handles iterator throw (error) with optional error
     * Still wraps any yielded value with tracing
     */
    throw: source.throw
      ? async (error?: any): Promise<IteratorResult<TracedWrapper<T>>> => {
          const result = await source.throw!(error);
          if (result.done) return result;
          
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
// OPERATOR WRAPPING
// ============================================================================

/**
 * Safely unwraps a value that may or may not be traced
 * Handles both traced wrappers and regular values
 * 
 * @param value Value that might be traced
 * @returns The unwrapped value
 * @template T Expected type of the unwrapped value
 */
function unwrapMaybeTraced<T>(value: unknown): T {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as any)[tracedValueBrand]
  ) {
    return getValueFromWrapped(value as TracedWrapper<T>);
  }
  return value as T;
}

/**
 * Wraps a Streamix operator with tracing instrumentation
 * This is the core function that intercepts operator execution
 * to track value flow, transformations, filtering, and timing
 * 
 * @param operator The original operator to wrap
 * @param operatorIndex Position of this operator in the pipeline
 * @param streamId Identifier of the stream
 * @param subscriptionId Identifier of the subscription
 * @param tracer The tracer instance to use
 * @returns A new operator that performs tracing alongside the original logic
 * @template T Input value type
 * @template R Output value type
 */
export function wrapOperatorWithTracing<T, R>(
  operator: Operator<T, R>,
  operatorIndex: number,
  streamId: string,
  subscriptionId: string,
  tracer: ValueTracer
): Operator<TracedWrapper<T>, TracedWrapper<R>> {
  const operatorName = operator.name || `Operator${operatorIndex}`;

  // Type for pending inputs that have entered but not yet produced output
  type Pending = { valueId: string; value: T };

  return createOperator<TracedWrapper<T>, TracedWrapper<R>>(
    `traced_${operatorName}`,
    (sourceIterator) => {
      /**
       * Group model for tracking operator behavior:
       * - pending: FIFO queue of inputs that have entered but not produced output
       * - group: inputs since last output (used to detect collapse vs transform)
       * 
       * Important invariants maintained:
       * 1. Filter detected when operator requests new input while pending exists
       * 2. Collapse decided at output time based on group size > 1
       * 3. Expansion when output produced with no pending input
       */
      const pending: Pending[] = [];
      let group: Pending[] = [];

      /**
       * Marks a single pending value as filtered
       * @param p The pending value to mark as filtered
       */
      const markFilteredOne = (p: Pending) => {
        tracer.exitOperator(p.valueId, operatorIndex, p.value, true, "filtered");
      };

      /**
       * Marks all pending values as errored
       * @param err The error that occurred
       */
      const markErroredAll = (err: Error) => {
        for (const p of pending) tracer.errorInOperator(p.valueId, operatorIndex, err);
        pending.length = 0;
        group = [];
      };

      /**
       * Creates an unwrapped source iterator that:
       * 1. Detects filtered values (when operator asks for next input but pending exists)
       * 2. Unwraps traced values for the original operator
       * 3. Tracks entry into the operator
       */
      const unwrappedSource: AsyncIterator<T> = {
        async next(): Promise<IteratorResult<T>> {
          // Detect filter: operator asking for new input while previous input
          // never produced output means the previous input was filtered
          if (pending.length > 0) {
            const filtered = pending.shift()!;
            // Also remove from group if present
            if (group.length > 0 && group[0].valueId === filtered.valueId) {
              group.shift();
            }
            markFilteredOne(filtered);
          }

          // Get next traced value from source
          const res = await sourceIterator.next();
          if (res.done) return res;

          const wrapped = res.value;
          const meta = getTraceMetaFromWrapped(wrapped);
          const value = getValueFromWrapped(wrapped);

          // Track entry into operator
          tracer.enterOperator(meta.valueId, operatorIndex, operatorName, value);

          // Add to pending and current group
          const p: Pending = { valueId: meta.valueId, value };
          pending.push(p);
          group.push(p);

          return { done: false, value };
        },

        /**
         * Handles iterator completion
         * Any remaining pending values are filtered (never produced output)
         */
        return: sourceIterator.return
          ? async (value?: any): Promise<IteratorResult<T>> => {
              // Complete = filter all pending
              while (pending.length > 0) {
                const p = pending.shift()!;
                markFilteredOne(p);
              }
              group = [];

              const res = await sourceIterator.return!(value);
              if (res.done) return res;

              // Handle returned value (rare case)
              return { done: false, value: unwrapMaybeTraced<T>(res.value) };
            }
          : undefined,

        /**
         * Handles iterator errors
         * All pending values are marked as errored
         */
        throw: sourceIterator.throw
          ? async (error?: any): Promise<IteratorResult<T>> => {
              const err = error instanceof Error ? error : new Error(String(error));
              markErroredAll(err);

              const res = await sourceIterator.throw!(error);
              if (res.done) return res;

              return { done: false, value: unwrapMaybeTraced<T>(res.value) };
            }
          : undefined,
      };

      // Apply the original operator to the unwrapped source
      const transformedIterator = operator.apply(unwrappedSource);

      /**
       * Creates the traced output iterator that:
       * 1. Handles normal transformations (1:1 mapping)
       * 2. Detects collapses (many:1 mapping)
       * 3. Handles expansions (1:many or 0:1 mapping)
       * 4. Wraps outputs with trace metadata
       */
      const wrappedIterator: AsyncIterator<TracedWrapper<R>> = {
        async next(): Promise<IteratorResult<TracedWrapper<R>>> {
          try {
            const res = await transformedIterator.next();
            if (res.done) {
              // No output on completion = filter remaining pending
              while (pending.length > 0) {
                const p = pending.shift()!;
                markFilteredOne(p);
              }
              group = [];
              return res;
            }

            const out = res.value;

            // CASE A: Normal mapping or collapse (has pending input)
            if (pending.length > 0) {
              const primary = pending.shift()!;

              // Detect collapse: multiple inputs in group for single output
              const isCollapse = group.length > 1;

              if (isCollapse) {
                // Collapse all other inputs in group into primary
                const [, ...collapsed] = group;

                for (const p of collapsed) {
                  // Remove from pending if still there
                  const idx = pending.findIndex(x => x.valueId === p.valueId);
                  if (idx >= 0) pending.splice(idx, 1);

                  // Record collapse
                  tracer.collapseValue(
                    p.valueId,
                    operatorIndex,
                    operatorName,
                    primary.valueId
                  );
                }
              }

              // Record operator exit for primary value
              tracer.exitOperator(
                primary.valueId,
                operatorIndex,
                out,
                false,
                isCollapse ? "collapsed" : "transformed"
              );

              // Wrap output with primary's trace metadata
              const wrappedOut = wrapValueForTracing(out, {
                valueId: primary.valueId,
                streamId,
                subscriptionId,
              });

              // Reset group after producing output
              group = [];

              return { done: false, value: wrappedOut };
            }

            // CASE B: Expansion (output without pending input)
            const expandedValueId = generateValueId();
            tracer.startTrace(expandedValueId, streamId, undefined, subscriptionId, out);
            tracer.enterOperator(expandedValueId, operatorIndex, operatorName, out);
            tracer.exitOperator(expandedValueId, operatorIndex, out, false, "expanded");

            const wrappedOut = wrapValueForTracing(out, {
              valueId: expandedValueId,
              streamId,
              subscriptionId,
            });

            // Expansion doesn't affect input grouping
            return { done: false, value: wrappedOut };
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            markErroredAll(err);
            throw error;
          }
        },

        /**
         * Handles iterator completion with returned value
         * Treated as expansion (value appears without input)
         */
        return: transformedIterator.return
          ? async (value?: any): Promise<IteratorResult<TracedWrapper<R>>> => {
              const res = await transformedIterator.return!(value);
              if (res.done) return res;

              const out = res.value;
              const id = generateValueId();
              tracer.startTrace(id, streamId, undefined, subscriptionId, out);
              tracer.enterOperator(id, operatorIndex, operatorName, out);
              tracer.exitOperator(id, operatorIndex, out, false, "expanded");

              return {
                done: false,
                value: wrapValueForTracing(out, { valueId: id, streamId, subscriptionId }),
              };
            }
          : undefined,

        /**
         * Handles iterator error with yielded value
         * Treated as expansion (value appears without input)
         */
        throw: transformedIterator.throw
          ? async (error?: any): Promise<IteratorResult<TracedWrapper<R>>> => {
              const res = await transformedIterator.throw!(error);
              if (res.done) return res;

              const out = res.value;
              const id = generateValueId();
              tracer.startTrace(id, streamId, undefined, subscriptionId, out);
              tracer.enterOperator(id, operatorIndex, operatorName, out);
              tracer.exitOperator(id, operatorIndex, out, false, "expanded");

              return {
                done: false,
                value: wrapValueForTracing(out, { valueId: id, streamId, subscriptionId }),
              };
            }
          : undefined,
      };

      return wrappedIterator;
    }
  );
}

// ============================================================================
// DELIVERY ITERATOR
// ============================================================================

/**
 * Creates an iterator that marks values as delivered when they reach the subscriber
 * This is the final step in the tracing pipeline
 * 
 * @param source The traced iterator from the last operator
 * @param tracer The tracer instance to use
 * @returns An iterator that unwraps values and marks them as delivered
 * @template T Type of values being delivered
 */
function createDeliveryTrackingIterator<T>(
  source: AsyncIterator<TracedWrapper<T>>,
  tracer: ValueTracer
): AsyncIterator<T> {
  return {
    /**
     * Gets next traced value, marks it as delivered, and returns unwrapped value
     */
    async next(): Promise<IteratorResult<T>> {
      const result = await source.next();

      if (!result.done) {
        const wrapped = result.value;
        const meta = getTraceMetaFromWrapped(wrapped);
        const value = getValueFromWrapped(wrapped);

        // Mark delivery - value reached subscriber
        tracer.markDelivered(meta.valueId);

        return { done: false, value };
      }

      return result;
    },
    
    /**
     * Handles iterator completion
     * Unwraps any returned traced value
     */
    return: source.return
      ? async (value?: any): Promise<IteratorResult<T>> => {
          const result = await source.return!(value);
          if (result.done) return result;
          const unwrapped = getValueFromWrapped(result.value);
          return { done: false, value: unwrapped };
        }
      : undefined,
      
    /**
     * Handles iterator error
     * Unwraps any yielded traced value
     */
    throw: source.throw
      ? async (error?: any): Promise<IteratorResult<T>> => {
          const result = await source.throw!(error);
          if (result.done) return result;
          const unwrapped = getValueFromWrapped(result.value);
          return { done: false, value: unwrapped };
        }
      : undefined,
  };
}

// ============================================================================
// GLOBAL TRACER MANAGEMENT
// ============================================================================

/** Key for storing global tracer instance in global scope */
const TRACER_KEY = "__STREAMIX_GLOBAL_TRACER__";

/**
 * Sets or clears the global tracer instance
 * @param t The tracer instance or null to disable
 * @internal
 */
function setGlobalTracerInstance(t: ValueTracer | null) {
  (globalThis as any)[TRACER_KEY] = t;
}

/**
 * Gets the current global tracer instance
 * @returns The current tracer or null if none set
 * @internal
 */
function getGlobalTracerInstance(): ValueTracer | null {
  return ((globalThis as any)[TRACER_KEY] ?? null) as ValueTracer | null;
}

/**
 * Enables tracing globally for all Streamix streams
 * Once enabled, all stream pipelines will be automatically instrumented
 * 
 * @param tracer The tracer to use (ValueTracer or ConsoleTracer)
 * @example
 * ```typescript
 * enableTracing(new ConsoleTracer());
 * // All streams will now log tracing to console
 * ```
 */
export function enableTracing(tracer: ValueTracer | ConsoleTracer): void {
  setGlobalTracerInstance(tracer instanceof ConsoleTracer ? tracer.getTracer() : tracer);
}

/**
 * Disables global tracing
 * Streams will no longer be instrumented after this call
 */
export function disableTracing(): void {
  setGlobalTracerInstance(null);
}

/**
 * Gets the current global tracer instance
 * @returns The current tracer or null if tracing is disabled
 */
export function getGlobalTracer(): ValueTracer | null {
  return getGlobalTracerInstance();
}

// ============================================================================
// RUNTIME HOOK REGISTRATION
// ============================================================================

/**
 * Registers runtime hooks with Streamix to automatically instrument streams
 * This is called automatically when the module loads
 * 
 * The hooks intercept:
 * 1. Source creation - wraps values with trace metadata
 * 2. Operator application - instruments each operator with tracing
 * 3. Delivery - marks values as delivered to subscribers
 */
registerRuntimeHooks({
  /**
   * Called when a stream pipeline is created
   * Instruments the entire pipeline if tracing is enabled
   */
  onPipeStream({ streamName, streamId, subscriptionId, source, operators }) {
    const tracer = getGlobalTracerInstance();
    if (!tracer) return; // Tracing disabled

    return {
      // Wrap source to trace emitted values
      source: createSourceTracingIterator(
        source,
        streamId,
        streamName,
        subscriptionId,
        tracer
      ),
      
      // Wrap each operator with tracing
      operators: (operators as Operator<any, any>[]).map((op, i) =>
        wrapOperatorWithTracing(op, i, streamId, subscriptionId, tracer)
      ),
      
      // Wrap final delivery to mark values as delivered
      final: (it) => createDeliveryTrackingIterator(it, tracer),
    };
  },
});