import { derived, flow, type Atom } from "./atom";

export const DERIVED_EXPR = Symbol("streamix.derivedExpr");
export const PIPE_EXPR = Symbol("streamix.pipeExpr");
export const FLOW_EXPR = Symbol("streamix.flowExpr");

export interface DerivedExpr<T = any> {
  [DERIVED_EXPR]: true;
  fn: (self: any) => T;
}

export interface PipeExpr<T = any> {
  [PIPE_EXPR]: true;
  fn: (self: any) => Atom<T>;
}

export interface FlowExpr<T = any> {
  [FLOW_EXPR]: true;
  fn: (self: any) => AsyncIterable<T> | Iterable<T>;
}

export function isDerivedExpr(value: any): value is DerivedExpr {
  return value != null && typeof value === "object" && value[DERIVED_EXPR] === true;
}

export function isPipeExpr(value: any): value is PipeExpr {
  return value != null && typeof value === "object" && value[PIPE_EXPR] === true;
}

export function isFlowExpr(value: any): value is FlowExpr {
  return value != null && typeof value === "object" && value[FLOW_EXPR] === true;
}

export function derivedExpr<T>(fn: (self: any) => T): DerivedExpr<T> {
  return { [DERIVED_EXPR]: true, fn };
}

export function pipeExpr<T>(fn: (self: any) => Atom<T>): PipeExpr<T> {
  return { [PIPE_EXPR]: true, fn };
}

export function flowExpr<T>(fn: (self: any) => AsyncIterable<T> | Iterable<T>): FlowExpr<T> {
  return { [FLOW_EXPR]: true, fn };
}

export function isExprMarker(value: any): value is DerivedExpr | PipeExpr | FlowExpr {
  return isDerivedExpr(value) || isPipeExpr(value) || isFlowExpr(value);
}

export function evaluateExprMarker(marker: DerivedExpr | PipeExpr | FlowExpr, self: any): Atom<any> {
  if (isDerivedExpr(marker)) {
    return derived(() => marker.fn(self));
  }
  if (isPipeExpr(marker)) {
    return marker.fn(self);
  }
  if (isFlowExpr(marker)) {
    return flow(marker.fn(self));
  }
  throw new Error("Unknown expression marker");
}
