import { atom, derived, flow, type Atom } from "./atom";

export const ATOM_EXPR = Symbol("streamix.atomExpr");
export const DERIVED_EXPR = Symbol("streamix.derivedExpr");
export const PIPE_EXPR = Symbol("streamix.pipeExpr");
export const FLOW_EXPR = Symbol("streamix.flowExpr");
export const DYNAMIC_EXPR = Symbol("streamix.dynamicExpr");

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

export interface DynamicExpr<T = any, Self = any> {
  [DYNAMIC_EXPR]: true;
  fn: (self: Self) => Atom<T> | T;
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

export function isDynamicExpr(value: any): value is DynamicExpr {
  return value != null && typeof value === "object" && value[DYNAMIC_EXPR] === true;
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

export function dynamicExpr<T, Self = any>(fn: (self: Self) => Atom<T> | T): DynamicExpr<T, Self> {
  return { [DYNAMIC_EXPR]: true, fn };
}

export function isExprMarker(value: any): value is AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr {
  return isAtomExpr(value) || isDerivedExpr(value) || isPipeExpr(value) || isFlowExpr(value) || isDynamicExpr(value);
}

/**
 * Creates expression-marker helpers bound to a specific `Self` shape.
 *
 * Useful in object-shorthand scopes where you want the marker callbacks to
 * receive a typed `self` without annotating each marker individually:
 *
 * ```ts
 * interface AppShape { query: string; count: number; }
 * const { derivedExpr, pipeExpr } = exprMarkers<AppShape>();
 *
 * const app = scope({
 *   query: '',
 *   count: derivedExpr((self) => self.query.length),
 *   results: pipeExpr((self) => pipe(self.query, search)),
 * });
 * ```
 */
export function exprMarkers<Self>(): {
  atomExpr: <T>(initialValue?: T) => AtomExpr<T>;
  derivedExpr: <T>(fn: (self: Self) => T) => DerivedExpr<T, Self>;
  pipeExpr: <T>(fn: (self: Self) => Atom<T>) => PipeExpr<T, Self>;
  flowExpr: <T>(fn: (self: Self) => AsyncIterable<T> | Iterable<T>) => FlowExpr<T, Self>;
} {
  return {
    atomExpr: <T,>(initialValue?: T) => atomExpr(initialValue),
    derivedExpr: <T,>(fn: (self: Self) => T) => derivedExpr<T, Self>(fn),
    pipeExpr: <T,>(fn: (self: Self) => Atom<T>) => pipeExpr<T, Self>(fn),
    flowExpr: <T,>(fn: (self: Self) => AsyncIterable<T> | Iterable<T>) => flowExpr<T, Self>(fn),
  };
}

export function evaluateExprMarker(marker: AtomExpr | DerivedExpr | PipeExpr | FlowExpr | DynamicExpr, self: any): Atom<any> {
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
  if (isDynamicExpr(marker)) {
    const value = marker.fn(self);
    if (value && typeof value === "object" && (value as Atom<any>).type === "atom") {
      return value as Atom<any>;
    }
    return derived(() => marker.fn(self));
  }
  throw new Error("Unknown expression marker");
}
