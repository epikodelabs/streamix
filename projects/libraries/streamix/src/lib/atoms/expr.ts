import { atom, derived, flow, type Atom } from "./atom";

export const ATOM_EXPR = Symbol("streamix.atomExpr");
export const DERIVED_EXPR = Symbol("streamix.derivedExpr");
export const PIPE_EXPR = Symbol("streamix.pipeExpr");
export const FLOW_EXPR = Symbol("streamix.flowExpr");

export interface AtomExpr<T = any> {
  [ATOM_EXPR]: true;
  initialValue?: T;
}

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

export function isAtomExpr(value: any): value is AtomExpr {
  return value != null && typeof value === "object" && value[ATOM_EXPR] === true;
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

export function atomExpr<T>(initialValue?: T): AtomExpr<T> {
  return { [ATOM_EXPR]: true, initialValue };
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

export function isExprMarker(value: any): value is AtomExpr | DerivedExpr | PipeExpr | FlowExpr {
  return isAtomExpr(value) || isDerivedExpr(value) || isPipeExpr(value) || isFlowExpr(value);
}

export function evaluateExprMarker(marker: AtomExpr | DerivedExpr | PipeExpr | FlowExpr, self: any): Atom<any> {
  if (isAtomExpr(marker)) {
    return atom(marker.initialValue);
  }
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
