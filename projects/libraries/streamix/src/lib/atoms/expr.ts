import { type Atom } from "./atom";

export const ATOM_EXPR = Symbol("streamix.atomExpr");
export const DERIVED_EXPR = Symbol("streamix.derivedExpr");
export const PIPE_EXPR = Symbol("streamix.pipeExpr");
export const FLOW_EXPR = Symbol("streamix.flowExpr");

export interface AtomExpr<T = any> {
  [ATOM_EXPR]: true;
  initialValue?: T;
}

export interface DerivedExpr<T = any, Self = any> {
  [DERIVED_EXPR]: true;
  fn: (self: Self) => T;
}

export interface PipeExpr<T = any, Self = any> {
  [PIPE_EXPR]: true;
  fn: (self: Self) => Atom<T>;
}

export interface FlowExpr<T = any, Self = any> {
  [FLOW_EXPR]: true;
  fn: (self: Self) => AsyncIterable<T> | Iterable<T>;
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

export function derivedExpr<T, Self = any>(fn: (self: Self) => T): DerivedExpr<T, Self> {
  return { [DERIVED_EXPR]: true, fn };
}

export function pipeExpr<T, Self = any>(fn: (self: Self) => Atom<T>): PipeExpr<T, Self> {
  return { [PIPE_EXPR]: true, fn };
}

export function flowExpr<T, Self = any>(fn: (self: Self) => AsyncIterable<T> | Iterable<T>): FlowExpr<T, Self> {
  return { [FLOW_EXPR]: true, fn };
}

export function isExprMarker(value: any): value is AtomExpr | DerivedExpr | PipeExpr | FlowExpr {
  return isAtomExpr(value) || isDerivedExpr(value) || isPipeExpr(value) || isFlowExpr(value);
}
